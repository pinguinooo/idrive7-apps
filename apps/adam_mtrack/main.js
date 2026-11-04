'use strict';
/**
 * M Track Cluster - an M Track style cover over the instrument cluster (the cluster-render service's `panel`
 * target, 1920 x 720): bar tachs to 7,000 rpm, gear over speed in mph, side panels, corner gauges, shift-light
 * slats. It covers the real speedometer, so it shows only while every guard holds (logic.decide): the cover is on,
 * the drive mode is allowed, a valid speed arrived within 1 s, no Check Control message, BMW does not hold the
 * panel, no kill file, no recent error, live data. Any of them failing drops every layer within one tick (100 ms).
 * A hung app's cover blanks by itself (output.js dead-man switch); a crashed or exited app's connection closes and
 * the service drops its layers at once. Default off.
 * Centre screen: the settings pages (ui.js), drawn only when something changes. Every callback goes through
 * safety.guard: nothing may throw out of the main loop (three app crashes in ~33 s wipe every app).
 * Tunables: config.js. Pure parts: logic.js, geom.js, units.js, widgets.js.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const L = require('./logic');
const G = require('./geom');
const U = require('./units');
const W = require('./widgets');
const CAT = require('./catalogue');
const { createSafety } = require('./safety');
const { createOutput } = require('./output');
const { createPoll } = require('./poll');
const { ClusterRender } = require('./cluster_render_client');
const { Canvas } = require('./kit/canvas');
const { createUi } = require('./ui');

const CDS = 'de.bmw.infotainment.vehicle.CDS', V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const FES = 'de.bmw.infotainment.drivingexcitement.FES', TPMS = 'de.bmw.infotainment.vehicle.TPMS';
const KOMBI = 'de.bmw.infotainment.KombiIF', ENV = 'de.bmw.infrastructure.EnvironmentalInformation';
const VEH = 'de.bmw.infotainment.vehicle.Vehicle', CCM = 'de.bmw.infotainment.checkcontrol.CheckControlMaster';
const KI2 = 'de.bmw.infotainment.KombiInterface_2';
const PRESS_UNITS = { 1: 'BAR', 2: 'KPA', 3: 'PSI', BAR: 'BAR', KPA: 'KPA', PSI: 'PSI' }, TEMP_UNITS = { 1: 'C', 2: 'F', C: 'C', F: 'F' };
const CONS_L100 = { 1: (x) => x, 2: (x) => 282.481 / x, 3: (x) => 235.215 / x, 4: (x) => 100 / x,
    VERBRAUCH_IN_L_S_100KM: (x) => x, VERBRAUCH_IN_MPG_UK: (x) => 282.481 / x, VERBRAUCH_IN_MPG_US: (x) => 235.215 / x, VERBRAUCH_IN_KM_S_L: (x) => 100 / x };
const SPEED_KMH = { 1: 1, 2: U.KM_PER_MI, KM_S_H__KM: 1, MPH__MLS: U.KM_PER_MI };
const MODE_TAG = { sportplus: 'SPORT+', sport: 'SPORT', comfort: 'COMFORT' };
const isNum = U.isNum;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        try {
            const cfg = require('./config');
            const safety = createSafety({ cfg, log });
            const guard = safety.guard;
            const killPath = safety.killFile(ctx.dataDir);
            log.info('kill switch file: ' + killPath);
            const get = (k) => settings.get(k);
            const schema = settings.schema || (ctx.spec && ctx.spec.settings) || [];
            const moves = L.migrateSettings(get);
            moves.forEach((w) => { try { settings.set(w[0], w[1]); } catch (e) { log.warn('settings migration ' + w[0] + ': ' + e); } });
            const warned = Object.create(null);
            const read = () => {
                const r = L.readSettings(get, schema);
                r.bad.forEach((k) => { if (!warned[k]) { warned[k] = true; log.warn('settings: ' + k + ' was not valid, using ' + JSON.stringify(r.values[k])); } });
                return r.values;
            };
            let v = read();

            // the art: one deflated json in the app's art folder (art.pack on the car); without it the cover never arms
            let art = null;
            try { art = require('./kit/pack').open(path.join(__dirname, 'art')).json('art.json'); } catch (e) { art = null; }
            const artOk = !!(art && art.items && art.atlas);
            if (!artOk) log.error('art/art.json is missing or damaged: the cover stays off');
            const sc = (k, raw) => {
                const c = cfg.scaling[k];
                if (!c || !isNum(raw) || raw === c.invalid || (c.invalidFrom !== undefined && raw >= c.invalidFrom)) return null;
                return raw * c.factor + c.offset;
            };

            /* ---------- car state ---------- */
            let carMode = null, d = {}, speedAt = null, speedKmh = null, killed = safety.pollKill(fs, killPath);
            const carUnits = { press: null, temp: null };
            const cc = { active: new Set(), newAt: null };
            const vals = { tyres: { p: [], t: [] }, trip: {}, timer: null, peaks: { right: 0, brake: 0, left: 0, accel: 0 }, boost: null, fuelL: null, rangeKm: null, ambient: null };
            const seen = Object.create(null), watchRes = Object.create(null);
            const units = () => U.resolve(v.units, carUnits);
            const ifaceUp = (i) => !!(seen[i] || (watchRes[i] && watchRes[i].available));
            const avail = (id) => { const w = CAT.get(id); return !!w && w.needs.every(ifaceUp); };
            // emulator hooks (emufeed.js, never on a car): the handlers each interface was watched with, a speed block
            const hooks = { handlers: Object.create(null), blockSpeed: false };

            const output = createOutput({
                ClusterRender, socketPath: process.env.MTRACK_CR_SOCKET || undefined, log, cfg, guard, art: art || {},
                fault: (msg) => guard('cluster-render', () => { throw new Error(msg); })(),
            });

            // speed: alive = a valid value (not 65535) within speedStaleMs, notified or polled with the getter
            const speedIn = (x) => {
                if (hooks.blockSpeed) return false;
                const k = sc('speedRaw', x && x.speedVehicleCentreOfGravity);
                if (k !== null) { speedAt = Date.now(); speedKmh = k; }
                return true;
            };
            const speedPoll = createPoll({ field: 'statusCarSpeed2', name: 'speed', cfg: cfg.speedPoll, log, enabled: () => output.status().armed });
            const rpmPoll = createPoll({ field: 'statusEngineSpeed2', name: 'rpm', cfg: cfg.rpmPoll, log, enabled: () => output.status().shown && !d.demo });
            const watched = [];
            const signals = ctx.signals && Object.assign({}, ctx.signals, {
                watch(iface, inst, handlers, lg, opts) {
                    const h = {};
                    Object.keys(handlers || {}).forEach((f) => { const fn = handlers[f]; h[f] = (x) => { seen[iface] = true; return fn(x); }; });
                    let poll = null, own = null;
                    if (iface === V2 && h.statusCarSpeed2) { const f0 = h.statusCarSpeed2; own = (x) => { if (speedIn(x) !== false) f0(x); }; poll = speedPoll; h.statusCarSpeed2 = poll.wrap(own); }
                    if (iface === CDS && h.statusEngineSpeed2) { own = h.statusEngineSpeed2; poll = rpmPoll; h.statusEngineSpeed2 = poll.wrap(own); }
                    (hooks.handlers[iface] = hooks.handlers[iface] || []).push(h);
                    const p = Promise.resolve(ctx.signals.watch(iface, inst, h, lg, opts));
                    watched.push(p);
                    p.then(guard('watch ' + iface, (res) => { watchRes[iface] = res; if (poll) poll.attach(res, own); }), () => {});
                    return p;
                },
            });

            const walk = (o, fn) => {
                if (!o || typeof o !== 'object') return;
                if (Array.isArray(o)) { o.forEach((x) => walk(x, fn)); return; }
                fn(o);
                Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') walk(o[k], fn); });
            };
            const tyreP = (raw) => {
                const x = sc('tyrePress', raw);
                if (x === null) return null;
                const k = { BAR: 1, KPA: 0.01, PSI: 1 / 14.5038 }[carUnits.press];
                if (k) return x * k;
                if (x >= 0.8 && x <= 6) return x;
                if (x >= 7 && x < 60) return x / 14.5038;
                return x >= 60 && x <= 600 ? x / 100 : null;
            };
            const tyreT = (raw) => { const x = sc('tyreTemp', raw); return x !== null && carUnits.temp === 'F' ? (x - 32) * 5 / 9 : x; };
            const extra = {
                [FES]: {
                    statusFESVehicleDynamicSwitchHMI: guard('drive mode', (x) => {
                        const raw = x && x.actualValueModeDrivingExperience, m = L.driveModeOf(raw);
                        if (m === carMode) return;
                        carMode = m;
                        log.info('car drive mode ' + JSON.stringify(raw) + ' -> ' + (m || 'none'));
                        coverTick(); changed();
                    }),
                    statusSwitchDriveDynamicSport2: guard('boost', (x) => { vals.boost = sc('boost', x && x.displayBoostPressure); }),
                },
                [TPMS]: {
                    statusTyrePressure: guard('tyre pressure', (x) => { vals.tyres.p = ['FLH', 'FRH', 'RLH', 'RRH'].map((w) => tyreP(x && x['actualValuePressureTyre' + w])); }),
                    statusTyreTemperature: guard('tyre temperature', (x) => { vals.tyres.t = ['FLH', 'FRH', 'RLH', 'RRH'].map((w) => tyreT(x && x['actualValueTemperatureTyre' + w])); }),
                },
                [KOMBI]: {
                    statusRangeTankStatus: guard('tank', (x) => {
                        const f = x && x.fluidLevelFuelTank, r = x && x.range;
                        vals.fuelL = isNum(f) && f >= 0 && f < 255 ? f : null;
                        vals.rangeKm = isNum(r) && r >= 0 && r < 4095 ? r : null;
                    }),
                    statusBordcomputerTravelData: guard('trip', (x) => {
                        const w = x && x.wayPassed, h = x && x.rideDurationHours, m = x && x.rideDurationMinutes;
                        vals.trip.km = isNum(w) && w < 65535 ? w : null;
                        vals.trip.h = isNum(h) && h < 65535 && isNum(m) && m < 60 ? h : null;
                        vals.trip.m = vals.trip.h === null ? null : m;
                    }),
                    statusBordcomputerAverage: guard('trip average', (x) => {
                        const c = x && x.consumptionAverage1BC1, s = x && x.speedAverage1BC1;
                        const cf = CONS_L100[x && x.statusUnitOfMeasurementConsumptionBC], sf = SPEED_KMH[x && x.statusUnitOfMeasurementSpeedBC];
                        vals.trip.avgL100 = isNum(c) && c > 0 && c < 65535 && cf ? cf(c * 0.1) : null;
                        vals.trip.avgKmh = isNum(s) && s < 65535 && sf ? s * 0.1 * sf : null;
                    }),
                },
                [ENV]: { ExteriorTemperature: guard('outside temperature', (x) => { vals.ambient = sc('ambient', x && x.temperatureExterior); }) },
                [VEH]: {
                    statusNewCurrentUnitsStatusExt: guard('car units', (x) => {
                        const p = PRESS_UNITS[x && x.unitOfMeasurementAirPressure] || null, t = TEMP_UNITS[x && x.unitOfMeasurementTemperature] || null;
                        if (p === carUnits.press && t === carUnits.temp) return;
                        carUnits.press = p; carUnits.temp = t;
                        log.info('car units: pressure ' + (p || '?') + ', temperature ' + (t || '?'));
                        rearm(); changed();
                    }),
                },
                [CCM]: {
                    basicList: guard('check control', (x) => {
                        walk(x, (o) => {
                            if (o.ccmId === undefined) return;
                            if (o.activeState === 'AKTIV' || o.activeState === 0) cc.active.add(o.ccmId); else cc.active.delete(o.ccmId);
                        });
                        coverTick();
                    }),
                },
                [KI2]: { newCCMessage: guard('new check control', () => { cc.newAt = Date.now(); coverTick(); }) },
            };
            const car = new Car(Object.assign({}, ctx, { signals }), ['rpm', 'temps', 'speed', 'gear', 'accel', 'torque'], extra);

            /* ---------- the cover ---------- */
            let since = null, dec = { want: false, reason: 'off' }, slat = null, lastPanels = -Infinity, lastStats = Date.now();
            const ccKnown = () => ifaceUp(CCM);
            function rearm() {
                const want = v.coverOn === true && !killed && !safety.tripped() && artOk;
                if (want) {
                    if (output.arm(units().temp === 'C' ? 'metric' : 'us')) boxes(true);
                } else if (output.status().armed) {
                    output.disarm(v.coverOn !== true ? 'cover off' : killed ? 'kill file' : safety.tripped() ? 'stopped after errors' : 'no art');
                    since = null;
                }
            }
            function gearOf() {
                const st = d.stage, g = d.gear;
                if (st === 'P' || st === 'R' || st === 'N') return { gear: st, gearNo: null };
                if (st === 'D' || (isNum(g) && g >= 1)) return { gear: 'D', gearNo: isNum(g) && g >= 1 && g <= 8 ? g : null };
                return { gear: null, gearNo: null };
            }
            function frame() {
                const u = units(), th = L.thresholds(cfg, carMode || 'sportplus', d.oil);
                slat = L.step(slat, d.rpm, th, cfg);
                const kmh = isNum(speedKmh) ? speedKmh * cfg.speedFactor : null, g = gearOf();
                return {
                    yr: G.yOfRpm(isNum(d.rpm) ? d.rpm : 0, cfg.tach),
                    quads: G.centreQuads(art.atlas, { gear: g.gear, gearNo: g.gearNo, speed: kmh === null ? null : U.SPD(kmh, u), unit: u.speed, tag: MODE_TAG[carMode] }),
                    slats: v.coverSlats ? slat : null,
                    badge: !v.coverSlats || slat.lit === 0,
                    level: L.levelOf(cfg, v),
                };
            }
            function liveVals() {
                const now = new Date();
                return Object.assign({}, vals, {
                    coolant: d.coolant, oil: d.oil, torque: d.torque, gLat: d.gLat, gLong: d.gLong, mode: carMode,
                    kw: isNum(d.torque) && isNum(d.rpm) ? Math.max(0, d.torque * d.rpm / 9549) : null,
                    clock: { h: now.getHours(), m: now.getMinutes() },
                });
            }
            const boxCv = {}, boxKey = {};
            let cornerBase = null;
            function boxes(force) {
                if (!output.status().armed) return;
                const u = units(), lay = L.layoutOf(v), x = liveVals();
                if (!cornerBase) cornerBase = { cornerL: null, cornerR_us: null, cornerR_metric: null };
                const baseOf = (n) => {
                    if (!cornerBase[n]) { const it = art.items.filter((i) => i.name === n)[0]; cornerBase[n] = require('zlib').inflateRawSync(Buffer.from(it.data, 'base64')); }
                    return cornerBase[n];
                };
                const put = (n, key, draw) => {
                    if (!force && boxKey[n] === key) return;
                    boxKey[n] = key;
                    const r = G.RECTS[n], cv = boxCv[n] || (boxCv[n] = new Canvas(r.w, r.h));
                    draw(cv, r);
                    output.box(n, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length));
                };
                put('panelL', W.panelKey(lay.left, x, u, avail, cfg), (cv, r) => W.drawPanel(cv, r, -1, lay.left, x, u, avail, cfg));
                put('panelR', W.panelKey(lay.right, x, u, avail, cfg), (cv, r) => W.drawPanel(cv, r, 1, lay.right, x, u, avail, cfg));
                put('cornerL', W.cornerKey(-1, x, u, cfg), (cv, r) => W.drawCorner(cv, r, -1, baseOf('cornerL'), x, u, cfg));
                put('cornerR', W.cornerKey(1, x, u, cfg) + (u.temp === 'C' ? 'm' : 'u'), (cv, r) => W.drawCorner(cv, r, 1, baseOf(u.temp === 'C' ? 'cornerR_metric' : 'cornerR_us'), x, u, cfg));
            }
            function coverTick() {
                const now = Date.now(), st = output.status();
                const s = {
                    coverOn: v.coverOn, killed, tripped: safety.tripped(), demo: !!d.demo, link: st.link, ccKnown: ccKnown(),
                    ccActive: cc.active.size > 0, ccNewAt: cc.newAt, target: st.target, holder: st.holder, speedAt,
                    lastErrorAt: safety.lastErrorAt(), mode: carMode, when: v.whenToShow,
                };
                const r = L.decide(s, now, since, cfg);
                since = r.since;
                const before = dec.reason;
                dec = r;
                if (!r.want && st.shown) output.drop(r.reason);
                else if (r.want && !st.shown) { output.show(frame()); log.info('cover: shown'); }
                else if (r.want) output.update(frame());
                output.tick(Date.now());   // after show() stamped its start: an older `now` would read as a clock jump
                if (r.reason !== before) changed();
            }
            const tick = guard('cover', () => {
                const k = safety.pollKill(fs, killPath);
                if (k !== killed) { killed = k; log.warn(k ? 'kill file found: cover off' : 'kill file gone: cover allowed'); rearm(); changed(); }
                coverTick();
                const now = Date.now();
                if (now < lastPanels || now - lastPanels >= 1000 / cfg.panelHz) { lastPanels = now; boxes(false); }
                if (now < lastStats || now - lastStats >= cfg.statsLogMs) {
                    const sp = speedPoll.stats();
                    log.info('speed alive ' + (isNum(speedAt) ? (now - speedAt) + ' ms ago' : 'never') + ', notified/s ' + sp.notified.toFixed(1) + ', speed poll ' + sp.polled.toFixed(1) + '/s, poll failures ' + sp.fails + ', cover ' + dec.reason);
                    lastStats = now;
                }
            });
            safety.onError(() => { if (output.status().shown) output.drop('error'); since = null; });
            safety.onTrip(() => { output.disarm('stopped after errors'); since = null; changed(); });

            /* ---------- samples ---------- */
            const OFF_PEAK = { right: 0, brake: 0, left: 0, accel: 0 };
            car.onSample(guard('sample', (data) => {
                d = data;
                if (!d.demo) {
                    if (isNum(d.gLat)) { vals.peaks.right = Math.max(vals.peaks.right, d.gLat); vals.peaks.left = Math.max(vals.peaks.left, -d.gLat); }
                    if (isNum(d.gLong)) { vals.peaks.accel = Math.max(vals.peaks.accel, d.gLong); vals.peaks.brake = Math.max(vals.peaks.brake, -d.gLong); }
                    if (isNum(speedKmh)) vals.timer = L.timerStep(vals.timer, speedKmh, Date.now(), units().speed === 'mph' ? 60 * U.KM_PER_MI : 100);
                }
                // the revs and the slats follow each sample at once (Shift Lights' latency lesson), the rest the tick
                if (dec.want && output.status().shown) output.update(frame());
            }), guard('source', () => { slat = null; vals.peaks = Object.assign({}, OFF_PEAK); coverTick(); changed(); }));

            /* ---------- settings pages ---------- */
            const pages = createUi();
            let drawQueued = false;
            const draw = guard('draw', () => {
                drawQueued = false;
                if (!ui.isVisible('MAIN')) return undefined;
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
                pages.draw(cv, t, { get, schema, cfg, carMode, reason: dec.reason, avail, version: (ctx.spec && ctx.spec.version) || '' }, act);
                return ui.image('MAIN_GFX', cv);
            });
            function changed() { if (!drawQueued) { drawQueued = true; setTimeout(draw, 0); } }
            const act = (writes) => guard('ui ' + writes.map((w) => w[0]).join(' '), () => { writes.forEach((w) => settings.set(w[0], w[1])); });

            let wasOn = v.coverOn === true;
            settings.onChange(guard('settings', (key, value) => {
                const before = v;
                v = read();
                if (key === 'coverOn') {
                    if (value === true && !wasOn && safety.tripped()) { safety.reset(); log.info('safety reset by Cover the cluster'); }
                    wasOn = value === true;
                }
                rearm();                                   // cover off: disarmed here, not on the next tick
                if (key === 'coverSlats' && before.coverSlats !== v.coverSlats && output.status().shown) { output.drop('slats setting'); output.show(frame()); }
                boxes(false);
                coverTick();
                changed();
            }));
            ui.onClick('BTN_COVER', guard('cover on/off', () => settings.cycle('coverOn')));
            if (ctx.hideButton) ['BTN_COVER', 'BTN_ALL'].forEach((b) => ctx.hideButton(b));
            ui.onClick('BTN_ALL', guard('settings button', () => ui.open && ui.open('SETTINGS')));
            ui.onVisible(guard('visible', (name, on) => { if (name === 'MAIN' && on) changed(); }));
            if (ctx.onTab) ctx.onTab(guard('tab', (i) => { pages.tab(i); changed(); }));
            if (ctx.onLayout) ctx.onLayout(guard('layout', changed));
            if (ui.onFocus) ui.onFocus(guard('focus', (name, on) => { if (name === 'MAIN' && on) changed(); }));

            // exit: drop and close at once (best effort; a crash closes the socket and the service drops the layers)
            process.on('exit', () => { try { output.disarm('exit'); } catch (e) { /* exiting */ } });
            if (process.env.MTRACK_EMU_FEED) require('./emufeed').start(process.env.MTRACK_EMU_FEED, hooks, log, guard);

            Promise.all(watched).then(guard('polls start', () => { speedPoll.start(); rpmPoll.start(); }), (e) => log.warn('polls not started: ' + e));
            setInterval(tick, cfg.safety.tickMs);
            rearm();
            changed();
            log.info('started: cover ' + (v.coverOn ? 'on' : 'off') + ', when ' + v.whenToShow + ', units ' + v.units + ', panels ' + JSON.stringify(L.layoutOf(v)));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});

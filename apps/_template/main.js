'use strict';
/**
 * Template app: one canvas screen with the vehicle speed and the "Enabled" setting.
 * Copy the folder to apps/<new_id>, then edit app.json (id, title, loggingId, signals, screens, settings) and this file.
 * Node 8 only (the car's version): no ?. ?? import, object spread, flat(), class fields.
 * Nothing may throw out of a callback: the kit exits the app on an uncaught exception and the car wipes, then
 * uninstalls, an app that crashes. So every callback goes through guard().
 */
const mgu = require('./kit/mgu');
const Car = require('./kit/car');

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            const car = new Car(ctx, ['speed']);
            let d = {};
            car.onSample(guard('sample', (data) => { d = data; }));
            ctx.loop('MAIN', 4, guard('draw', async () => {
                const t = ctx.theme(), cv = ctx.canvas(1600, 520).clear(t.bg);
                const kmh = isFinite(d.speed) ? Math.round(d.speed) + ' km/h' : '- km/h';
                cv.text(settings.get('enabled') ? kmh : 'OFF', 800, 280, 120, t.text, { align: 'center', font: 'num' });
                await ui.image('MAIN_GFX', cv);
            }));
            log.info('started');
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});

/**
 * The stub `metro.config.js` resolves unreachable modules to.
 *
 * An empty object, deliberately — NOT a throwing proxy. Every module stubbed
 * here is `require`d at module scope by a dependency and only dereferenced
 * inside a callback that this app never reaches, so the import must succeed
 * silently and any property read must yield `undefined`. A throwing stub would
 * turn "this code path is dead" into a crash at import time.
 *
 * See metro.config.js for what is stubbed and the evidence that each is dead.
 */
module.exports = {};

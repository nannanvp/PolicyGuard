// Compatibility entry point. The original single-screen prototype is archived.
const { start } = require('./app-server');
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = require('./app-server');

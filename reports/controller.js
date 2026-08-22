const { getReportProcessor } = require('./reportTypes');
const RESTError = require('../utils/RESTError');

async function runProcessor(name, from, to) {
    const processor = getReportProcessor(name);
    if (processor && typeof processor === 'function') {
        return await processor(name, from, to);
    } else {
        throw new RESTError(400, "Invalid report type");
    }
}

module.exports = {
    runProcessor
}   
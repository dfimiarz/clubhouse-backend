const sqlconnector = require("../db/SqlConnector");
const club_id = process.env.CLUB_ID;
const RESTError = require("../utils/RESTError");
const { parseJsonColumn } = require("../utils/dbutils");
const { log, appLogLevels } = require("../utils/logger/logger");

/**
 * @typedef {import("./types").PaymentType} PaymentType;
 */

/**
 *
 * @returns {Promise<Array<PaymentType>>}
 */
const getPaymentTypes = async () => {
  const payment_types_q = `
  SELECT 
    pt.id,
    pt.club,
    pt.name,
    pt.fee,
    pt.fee_type,
    pp.name as processor,
    pp.validator,
    JSON_MERGE_PATCH(pp.default_config,pt.processor_config) as processor_config 
  FROM clubhouse.payment_types pt 
  JOIN payment_processors pp on pp.id = pt.processor 
  WHERE club = ?`;

  try {
    const payment_types_res = await sqlconnector.withConnection(
      async (connection) => {
        return sqlconnector.runExecute(connection, payment_types_q, [club_id]);
      }
    );

    if (!Array.isArray(payment_types_res) || payment_types_res.length < 1) {
      throw new RESTError(400, "Failed loading payment types");
    }

    return payment_types_res.map((payment_type) => {
      return {
        id: payment_type.id,
        name: payment_type.name,
        fee: payment_type.fee,
        fee_type: payment_type.fee_type,
        processor: payment_type.processor,
        processor_config: parseJsonColumn(payment_type.processor_config),
        validator: payment_type.validator,
      };
    });
  } catch (error) {
    if (error instanceof RESTError) {
      throw error;
    }

    log(appLogLevels.ERROR, `Error retrieving payment types: ${error.message}`);
    throw new RESTError(500, "Failed fetching payment types");
  }
};

module.exports = {
  getPaymentTypes,
};

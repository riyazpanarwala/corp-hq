/**
 * Executes a database operation within a transaction using Serializable isolation.
 * Reuses an already enclosing transaction client if provided, or retries on serialization
 * conflicts (P2034) or concurrent unique violations (P2002) up to 2 retry attempts.
 *
 * @param {object} client - Prisma client or active transaction client
 * @param {Function} operation - Async callback receiving the transactional client
 * @returns {Promise<any>} Result of the transaction operation
 */
async function runTransaction(client, operation) {
  if (!client.$transaction) return operation(client);
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(operation, { isolationLevel: "Serializable", timeout: 15000 });
    } catch (err) {
      if (attempt >= 2 || !["P2034", "P2002"].includes(err.code)) throw err;
    }
  }
}

module.exports = { runTransaction };

// Reuse an enclosing transaction, or retry PostgreSQL serialization conflicts.
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

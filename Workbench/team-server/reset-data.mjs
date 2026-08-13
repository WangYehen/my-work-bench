import mysql from "mysql2/promise";

if (process.env.TEAM_REPORT_ALLOW_DATA_RESET !== "true") {
  throw new Error("数据清理是破坏性操作，请设置 TEAM_REPORT_ALLOW_DATA_RESET=true 后重试。");
}

const db = await mysql.createConnection({ uri: process.env.MYSQL_URL, multipleStatements: false });
await db.beginTransaction();
try {
  const [[reports]] = await db.query("SELECT COUNT(*) AS count FROM daily_reports");
  const [[users]] = await db.query("SELECT COUNT(*) AS count FROM users");
  const [[audit]] = await db.query("SELECT COUNT(*) AS count FROM audit_logs");
  console.log(JSON.stringify({ before: { users: users.count, reports: reports.count, auditLogs: audit.count } }));
  await db.query("DROP TABLE IF EXISTS daily_reports");
  await db.query("DROP TABLE IF EXISTS audit_logs");
  await db.query("DROP TABLE IF EXISTS users");
  const schema = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./schema.sql", import.meta.url), "utf8"));
  for (const statement of schema.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) await db.query(statement);
  await db.commit();
  console.log("已清除旧账号、旧成员、历史日报和相关审计记录。");
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}

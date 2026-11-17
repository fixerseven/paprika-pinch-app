import { openDb } from "../src/lib/db";

const db = openDb(process.env.PINCH_DB_PATH || "./data/pinch.db");
console.log("Database is up to date.");
db.close();

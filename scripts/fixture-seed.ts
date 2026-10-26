// Prints SQL that loads synthetic words into a D1 database: `npm run db:fixture:local`.
import { fixtureWords, insertSql } from "../test/fixtures/words.ts";

const count = Number(process.argv[2] ?? 7500);
console.log(insertSql([...fixtureWords("en", count), ...fixtureWords("fr", count)]));

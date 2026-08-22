// CLI de migracions.

import { runMigrations } from "./migrate-lib";

runMigrations()
  .then((applied) => {
    console.log(applied.length === 0 ? "Cap migració pendent." : `Aplicades: ${applied.join(", ")}`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

import { db } from "@/lib/db";
import { seed } from "./index";

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

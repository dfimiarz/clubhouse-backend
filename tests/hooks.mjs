import { setupDatabase, teardownDatabase } from "./test-setup.mjs";

export const mochaGlobalSetup = async () => {
  try {
    await setupDatabase();
    console.log("SETUP: Database created or exists");
  } catch (err) {
    console.log(err);
  }
};

export const mochaGlobalTeardown = async () => {
  try {
    await teardownDatabase();
    console.log("SETUP: Database dropped if existed");
  } catch (err) {
    console.log(err);
  }
};

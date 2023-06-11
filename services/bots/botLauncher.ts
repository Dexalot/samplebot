import { getConfig } from "../../config";
import encrypter from "../EncryptionService";
const BotFactory = require("./BotFactory.js");

function cleanUpAndExit(botLaunched: any) {
  botLaunched?.cleanUpAndExit();
}

encrypter.setKey(getConfig("ENCYRPT_SECRET"), getConfig("ENCRYPT_SALT"));

const privkey = encrypter.isKeyEncrypted(getConfig("private_key"))
  ? encrypter.dencrypt(getConfig("private_key"))
  : getConfig("private_key");
const bot = BotFactory.createBot(getConfig("bot_type"), { botId: getConfig("bot_id"), pairStr: getConfig("pair"), privateKey: privkey });
bot.initialize().then(() => {
  bot.start();
});
// exit handler to remove all open buy and sell orders from all simulators
process.on("SIGINT", async () => {
  // Needed for Local Windows Ctrl-C
  cleanUpAndExit(bot);
});

process.on("exit", async () => {
  cleanUpAndExit(bot);
});

process.on("SIGTERM", async () => {
  //Needed for AWS
  cleanUpAndExit(bot);
});

process.on("uncaughtException", (error) => {
  console.log(`BotManager uncaughtException happened:`, error);
});

process.on("unhandledRejection", (error, promise) => {
  console.log(`BotManager We forgot to handle a promise rejection here:`, promise);
  console.log(`BotManager The error was:`, error);
});

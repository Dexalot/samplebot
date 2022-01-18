
import {getConfig}  from "../../config";
import encrypter from "../EncryptionService";

const BotFactory = require("./BotFactory.js");
encrypter.setKey(getConfig("ENCYRPT_SECRET"), getConfig("ENCRYPT_SALT"));

let privkey =  encrypter.isKeyEncrypted(getConfig("private_key")) ? encrypter.dencrypt(getConfig("private_key")): getConfig("private_key") ;
const bot = BotFactory.createBot(getConfig("bot_type"), {botId: getConfig("bot_id"), pairStr : getConfig("pair") , privateKey: privkey});
bot.initialize().then(() => {
  bot.start();
})

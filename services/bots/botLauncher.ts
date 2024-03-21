// Use this code snippet in your app.
// If you need more information about configurations or implementing the sample code, visit the AWS docs:
// https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started.html


import { getConfig } from "../../config";
const BotFactory = require("./BotFactory.js");
const config: any = getConfig(getConfig("pair"));

function cleanUpAndExit(botLaunched: any) {
  botLaunched?.cleanUpAndExit();
}

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secret_name = config.secret_name;

const client = new SecretsManagerClient({
  region: "ap-southeast-1",
});

client.send(
    new GetSecretValueCommand({
      SecretId: secret_name,
      VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
    })
  ).then((response)=>{

  const secret: any = response.SecretString;

  // Your code goes here

  const privkey = JSON.parse(secret)["dexalot_mm_"+getConfig("pair")];
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
    bot.cancelOrderList([], 100);
  });

  process.on("unhandledRejection", (error, promise) => {
    console.log(`BotManager We forgot to handle a promise rejection here:`, promise);
    console.log(`BotManager The error was:`, error);
    bot.cancelOrderList([], 100);
  });


  }).catch((error) => {
  // For a list of exceptions thrown, see
  // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
  throw error;
})

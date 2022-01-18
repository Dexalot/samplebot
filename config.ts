// Copyright 2017, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

// Hierarchical node.js configuration with command-line arguments, environment
// variables, and files.
import nconf from "nconf";
import path from "path";

nconf.use("memory");

//
// 1. any overrides
//
nconf.overrides({
  always: "be this value"
});

nconf
  // 1. Command-line arguments
  .argv()
  // 2. Environment variables
  // NODE_ENV_SETTINGS is used to control DB schema dev/prod
  // NODE_ENV is a GCP Environment Variable that cant be changed. it needs to be set to production for anything that is deployed to GCP
  .env([
    "NODE_ENV_SETTINGS",
    "CHAIN_INSTANCE",
    "CHAIN_ID",
    "API_URL"
  ]);

export const DEXALOT_ENV = {
  Dev: "development",
  DevLoc: "development-loc",
  Test: "fuji",
  Prod: "production",
  Staging: "staging"
};

const environment = getEnvironment();

nconf
  // 3.1 .env file that contains sensitive info like passwords
  .file("user", {
    file: path.join(__dirname, "/.env." + environment.toLowerCase())
  });

nconf
  // 3. Config file
  .file("global", {
    file: path.join(__dirname, "/config/" + environment.toLowerCase() + ".json")
  });

// 4. Defaults from file
nconf.file("default", { file: path.join(__dirname, "./config/default.json") });

nconf
  // 4.1 Defaults
  .defaults({
    // Typically you will create a bucket with the same name as your project ID.
    // CLOUD_BUCKET: ""
  });

let envType: string;
switch (environment) {
  case DEXALOT_ENV.Prod:
    envType = "prod";
    break;
  case DEXALOT_ENV.Staging:
    envType = "staging";
    break;
  case DEXALOT_ENV.Test:
    envType = "test";
    break;
  default:
    envType = "dev";
}
nconf.set("ENV_TYPE", envType);

// Check for required settings
// checkConfig("AUTH_API_PASSWORD");

export function checkConfig(setting: string): void {
  if (!getConfig(setting)) {
    throw new Error(`You must set ${setting} as an environment variable or in config.json!`);
  }
}

export function isLocalEnv(): boolean {
  const activeEnv = getConfig("NODE_ENV_SETTINGS");
  return activeEnv != DEXALOT_ENV.Prod && activeEnv != DEXALOT_ENV.Test && activeEnv != DEXALOT_ENV.Dev;
}


export function getEnvType(): string {
  return getConfig("ENV_TYPE");
}

export function getEnvironment(): string {
  return getConfig("NODE_ENV_SETTINGS") || DEXALOT_ENV.Dev;
}

export function getConfig(key: string): string {
  return nconf.get(key);
}

export function setConfig(key: string, value: string): string {
  return nconf.set(key, value);
}

export default nconf;

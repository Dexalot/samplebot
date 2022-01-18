import { format, transports, loggers, Logger } from "winston";
const  { printf } =  format;

import { DEXALOT_ENV, getConfig, getEnvironment, isLocalEnv } from "../config";

//https://www.section.io/engineering-education/logging-with-winston/
// Log levels for reference
// {
//   error: 0,
//   warn: 1,
//   info: 2,
//   http: 3,
//   verbose: 4,
//   debug: 5,
//   silly: 6
// }
// Format Example:
//format: format.combine(
//     format.timestamp({format: "MMM-DD-YYYY HH:mm:ss"}),
//     format.align(),
//     format.printf(info => `${info.level}: ${[info.timestamp]}: ${info.message}`),
// )}),
export function getLogger(serviceName: string, handleUncaughtExceptions?: boolean | undefined): Logger {
  if (loggers.has(serviceName)) {
    return loggers.get(serviceName);
  }
  const logger = loggers.add(serviceName, {
    defaultMeta: { service: serviceName }
  });

  if (handleUncaughtExceptions === true) {
    logger.exceptions.handle(new transports.File({ filename: "logs/exceptions.log" }));
  }

  // Set env defaults
  logger.add(new transports.File({ filename: "logs/server-error.log", level: "warn" }));

  const logLevelOverride = getConfig("LOG_LEVEL");
  const env = getEnvironment();
  console.log(`Enabling ${serviceName} logger for ${env}`);

  const myFormat = printf(({ level, message }) => {
    return `${level}: ${message}`;
  });

  switch (env) {
    case DEXALOT_ENV.Prod:
      logger.add(
        new transports.Console({
          level: "info",
          handleExceptions: handleUncaughtExceptions === true ? true : false,
          format: format.combine(
            format.errors({ stack: true }),
            format.splat(),
            format.json(),
            format.label({ label: serviceName, message: true }),
            myFormat
          )
        })
      );
      break;
    case DEXALOT_ENV.Dev:
    case DEXALOT_ENV.Test:
      logger.add(
        new transports.Console({
          level: logLevelOverride || "debug",
          handleExceptions: handleUncaughtExceptions === true ? true : false,
          format: format.combine(
            //format.colorize(),
            format.errors({ stack: true }),
            format.splat(),
            format.json(),
            format.label({ label: serviceName, message: true }),
            myFormat
          )
        })
      );
      logger.add(new transports.File({ filename: "logs/server.log", level: logLevelOverride || "debug" }));
      break;

      case DEXALOT_ENV.DevLoc:
        logger.add(
          new transports.Console({
            level: logLevelOverride || "debug",
            handleExceptions: handleUncaughtExceptions === true ? true : false,
            format: format.combine(
              format.colorize(),
              format.errors({ stack: true }),
              format.splat(),
              format.json(),
              format.label({ label: serviceName, message: true }),
              myFormat
            )
          })
        );
        logger.add(new transports.File({ filename: "logs/server.log", level: logLevelOverride || "debug" }));
        break;
    default:
      logger.add(
        new transports.Console({
          level: logLevelOverride || "debug",
          handleExceptions: handleUncaughtExceptions === true ? true : false,
          format: format.combine(
            format.colorize(),
            format.errors({ stack: true }),
            format.splat(),
            format.json(),
            format.label({ label: serviceName, message: true }),
            myFormat
          )
        })
      );
  }

  logger.on("finish", function () {
    // do nothing.
  });

  if (handleUncaughtExceptions === true) {
    logger.on("error", function (err) {
      // eslint-disable-next-line no-console
      console.error(`Logger err: ${err.message}`);
    });
  }

  return logger;
}

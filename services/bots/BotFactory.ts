


import SampleBot from "./SampleBot";
import LoadBot from "./LoadBot";
const Bot:any = {  SampleBot, LoadBot};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};

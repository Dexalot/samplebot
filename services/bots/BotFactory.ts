


import SampleBot from "./SampleBot";

const Bot:any = {  SampleBot};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey); 
    }
};

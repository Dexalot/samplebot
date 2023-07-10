


import SampleBot from "./SampleBot";
import avax_usdc from "./avax_usdc";
const Bot:any = {  SampleBot, avax_usdc};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};

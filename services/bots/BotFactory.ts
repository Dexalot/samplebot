import MarketMakerBot from "./MarketMakerBot";
const Bot:any = {MarketMakerBot};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};

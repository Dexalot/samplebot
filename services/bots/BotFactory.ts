import MarketMakerBot from "./MarketMakerBot";
import MarketMakerBotOrderLists from "./MarketMakerBotOrderLists";
const Bot:any = {marketMaker: MarketMakerBot, marketMakerLists: MarketMakerBotOrderLists};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};
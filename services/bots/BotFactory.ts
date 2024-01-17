import MarketMakerBot from "./MarketMakerBot";
import MarketMakerBotOrderLists from "./MarketMakerBotOrderLists";
import Analytics from "./Analytics";
const Bot:any = {marketMaker: MarketMakerBot, marketMakerLists: MarketMakerBotOrderLists, analytics: Analytics};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};
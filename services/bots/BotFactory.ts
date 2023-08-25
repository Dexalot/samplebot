import MarketMakerBot from "./MarketMakerBot";
import MarketMakerBotOrderLists from "./MarketMakerBotOrderLists";
import TakerBot from "./TakerBot";
const Bot:any = {marketMaker: MarketMakerBot, marketMakerLists: MarketMakerBotOrderLists, taker:TakerBot};

module.exports = {
    createBot(type:any, attributes:any) {
        const BotType = Bot[type];
        return new BotType(attributes.botId,attributes.pairStr,attributes.privateKey);
    }
};
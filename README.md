# Beastlorion's Dexalot MarketMaker

## Setup
```
nvm install 16.15.1
yarn install
```

You can get AVAX from fuji faucet and sell your avax against USDC at Dexalot Fuji at https://app.dexalot-test.com
if you need more USDC please contact the Dexalot Team.

Config parameters are declared in .env.production for production or .env.fuji for testnet.
For production, I recommend using a secrets manager for your wallet's private key for enhanced security. Also if you're using a remote server, which you probably should be, you should whitelist the IP that you will be connecting to it from.

Paste this into your .env.fuji with your private key and address. PLEASE USE A TEST WALLET.

```
{ "bot_id" : "100",
"bot_type" : "MarketMakerBot",
"private_key" : "xxx",
"account_no" : "xxx",
"rpc_url" : "",
"ENCYRPT_SECRET" : "secret",
"ENCRYPT_SALT" : "salt",
"AVAX/USDC" :
    {
    "bidSpread" : "0.3",
    "askSpread" : "0.3",
    "takerSpread" : "1.0",
    "takerEnabled" : false,
    "flatAmount" : "1",
    "orderLevels" : "2",
    "orderLevelSpread" : "0.30",
    "orderLevelQty" : "0.5",
    "refreshOrderTolerance" : "0.05",
    "refreshOrderTime" : "0",
    "defensiveSkew" : "0",
    "slip" : false,
    "useIndependentLevels" : false,
    "independentLevels": 
        {
        "2":{ 
            "customQty" : "2",
            "customSpread": "0.4",
            "tolerance": "0.3"
            },
        "3":{
            "customQty" : "4",
            "customSpread": "1",
            "tolerance": "0.75"
            }
        }
    },
}
```

To trade other markets(some are not active on the testnet), you will need to add objects for the tokens below the "AVAX/USDC" object. They are case sensitive.

Examples of other markets:

```
"AVAX/USDt"
"EUROC/USDC"
"USDt/USDC"
"WETH.e/USDC"
"BTC.b/USDC"
"sAVAX/AVAX"
```

## To run
- You will need to start a price_feeds instance which serves price data to a local port: https://github.com/Beastlorion/dexalotBot_price_feeds
- You can edit the price calculations there if you'd like.
- Once that is running on the same machine, run one of the following with your pair of choice:

MarketMakerLists (RECOMMENDED for beginners)
Fuji Testnet:
```
yarn marketMakerLists-fuji --pair="AVAX/USDC"
```

Production:
```
yarn marketMakerLists-prod --pair="AVAX/USDC"
```

Alternatively, if you have a custom rpc node, use this version to keep your orders active at all times:
Fuji Testnet:
```
yarn marketMaker-fuji --pair="AVAX/USDC"
```

Production:
```
yarn marketMaker-prod --pair="AVAX/USDC"
```


## Abstract Class Flow
AbstractBot performs various functions:
- Get the mainnet/subnet environments, pairs listed, token details from the RESTAPI
- Create references to the necessary contracts
- (unused currently) Deposit initial amounts to the contract from the mainnet for trading (Note it takes about 30 seconds for the deposit to reach the subnet)
- Requests open orders from the RESTAPI in case of crash recovery
- Keeps a list of its outstanding orders, and a local orderbook in memory
- Gets the best 2 bid/asks orderbook from the chain
- It listens to OrderStatusChanged events from the blockchain in case one of its outstading orders gets hit/lifted.
- it also captures OrderStatusChanged event as a part of tx results when sending an order and updates the order status in memory.
The OrderStatusChanged event raised from the blockchain to all the listeners a few seconds later. So the same event is processed twice.
Once when the order is sent out and again when it is received from the blockchain by the independent listener thread.
(I've commented these messages out ->)Hence it is normal to see the message "Duplicate Order event: ......"
- Double Checks the order status from the chain every 10 min, in case an OrderStatusChanged event is missed.
- When placing, replacing, or canceling orders, if there is an error, it may attempt to try again once or twice.

## MarketMakerBot Flow
MarketMakerBot extends the AbstractBot implementation. It holds the main logic for the bot:
- Fetches prices for the chosen market from the price_feed bot in getNewMarketPrice()
- Places initial PostOnly Orders using addLimitOrderList() and starts the order updater loop. If the orderLevels config is > 1, it will attempt to add an additional bid and ask with increased quantity based on the orderLevelsQty config
- orderUpdater() will run if certain conditions are met. During initialization it will run.
- The interval variable determines how long to wait after executing orders before calling orderUpdater() again. If orderUpdater did not run, it will retrigger in a few seconds, after it fetches fresh data.
- If the conditions are met, it will refresh balances, get the best bid and ask prices, and refresh the nonce of the wallet.
- Next it checks for the order levels of the orders and sorts them. If there are duplicate records somehow, it will cancel the offending orders and they will be added again on the next loop.
- If the "marketTakerEnabled" config == true AND the best bid or ask is passed the price threshold "takerSpread" config, it will trigger an "immediate or cancel" trade at marketPrice * (1 +/- takerSpread)
- If the conditions for a taker trade are not met, it will begin refreshing the prices and quantities of the orders for the pair taking care to avoid PostOnly trade conflicts.
- When it is finished it will set a timer and then begin calling orderUpdater() again.

## MarketMakerBotOrderLists (Recommended if not using your own rpc node)
This bot is an alternative to MarketMakerBot. The key difference is instead of replacing individual orders, it will cancel all of the active orders in one call, wait for confirmation, and then place all fresh orders in one call.

Pros:
- Uses far fewer calls, which is good for avoiding rate limitting. (If you're serious about this you'll want to start your own rpc node for unlimitted rpc calls. You can add a custom rpc url to the config file)
- The logic is much simpler and easier to understand.
- Allows for many orders for each pair with lower likelihood of errors. You could have 10 or more bids and sells active for each market.

Cons:
- Your orders will be off the books for about 6-8 seconds each time they need to be cancelled and replaced.
- Currently does not have taker orders enabled.

## DISCLAIMER

I am sharing this bot for free to encourage people to try providing liquidity for Dexalot Exchange. It is still a work in progress. I assume no responsibility for you or others using this.
USE AT YOUR OWN RISK

Good luck! :D

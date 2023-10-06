## Beastlorion's Custom Dexalot Bots

If you don't have nvm installed, follow the steps here: https://tecadmin.net/how-to-install-nvm-on-ubuntu-20-04/

## Setup:

```
nvm install 16.15.1
git checkout customized_beastlorion
yarn install
```

parameters are declared in .env.production for production or .env.fuji for testnet

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
    "refreshOrderTolerance" : "0.05"
    }
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

You can get AVAX from fuji faucet and sell your avax against USDC at Dexalot Fuji at https://app.dexalot-test.com
if you need more USDC please contact the Dexalot Team.

## To run
NOTE: You will need to either start a price_feeds instance or another service to serve prices for the bot. You can also hardcode a price for testing purposes in getNewMarketPrice()

Fuji Testnet:
```
yarn marketMakerBot-fuji --pair="AVAX/USDC"
```

Production:
```
yarn marketMakerBot-prod --pair="AVAX/USDC"
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

## MarketMakerBotOrderLists (I don't use this so check it carefully before you use it)
This bot is an alternative to MarketMakerBot. The key difference is instead of replacing individual orders, it will cancel all of the active orders in one call, wait for confirmation, and then place all fresh orders in one call.

Pros:
- Uses less calls/good for avoiding rate limitting. (If you're serious about this you'll want to start your own rpc node for unlimitted rpc calls.)
- The logic is much simpler and easier to understand.
Cons:
- Your orders will be off the books for about 8-12 seconds while it is waiting to get confirmation from transactions processing.


## TO DO
 Currently retrieves price feeds from another port on local host(which I'll add to a "price_feeds" repository). You may want to change how it calculates prices or where it fetches the prices from.


## DISCLAIMER

I am sharing this bot for the benefit of Dexalot Exchange. It is still a work in progress. I will assume no responsibility for others using this.
USE AT YOUR OWN RISK

Good luck! :D

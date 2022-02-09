const fs = require('fs');
const hive = require('@hiveio/hive-js');
const { updateRate, candleSize, candleLimit, tradeSize, username, pKey} = JSON.parse(fs.readFileSync('./settings.json'));
const EMA = require('technicalindicators').EMA;
const MACD = require('technicalindicators').MACD;

let globalState = {
    updateCounter : 0,
    candleCounter : 0,
    priceUpdateErrors : 0,
    tradeStatus : 'Generating data',

    priceTicker : {
        lowestAsk : 0,
        highestBid : 0
    },

    candleDataBase1 : [],
    candleDataBase2 : [],
    tempPriceHolder1 : [],
    tempPriceHolder2 : [],

    closePriceList : {},

    emaListHive : [],
    emaListHbd : [],
    macdListHive : [],
    macdListHbd : [],

    lastBuyTimeHive : new Date().getTime(),
    lastBuyTimeHbd : new Date().getTime(),

    hiveBuyCounter : 0,
    hiveBuyErrors : 0,

    hbdBuyCounter : 0,
    hbdBuyErrors : 0
};

const ema = (close, per) => {
    let input = {
        period: per,
        values: close
    };
    return EMA.calculate(input);
};

const macd = (close, fastPer, slowPer, signal) => {
    const macdInput = {
        values : close,
        fastPeriod : fastPer,
        slowPeriod : slowPer,
        signalPeriod : signal,
        SimpleMAOscillator : false,
        SimpleMASignal : false
    }
    return MACD.calculate(macdInput);
}

const round = (value, decimals) => {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
};

const logProgress = () => {
    console.log(`* Price updated (#${globalState.updateCounter})! - Current candles: ${globalState.candleDataBase1.length} / ${candleLimit} (Price check errors: ${globalState.priceUpdateErrors})`)
    console.log(`* Buy Hive Ticker: ${globalState.priceTicker.lowestAsk} - Buy Hbd Ticker: ${globalState.priceTicker.highestBid}`)
    console.log(`* Trade status: ${globalState.tradeStatus} ==> Hive buy count: ${globalState.hiveBuyCounter}(${globalState.hiveBuyErrors} errors) - Hbd buy count: ${globalState.hbdBuyCounter}(${globalState.hbdBuyErrors} errors)`)
    console.log('----------------------')
}

const tradingAlgo = (prevEma, prevmacd, prev2macd, preCandle) => {
    if ( 
        parseFloat(preCandle.close) > parseFloat(prevEma)
        && parseFloat(prevmacd.MACD) > parseFloat(prevmacd.signal)
        && parseFloat(prev2macd.MACD) < parseFloat(prev2macd.signal) && parseFloat(prev2macd.MACD) < 0
        ) {
        return true;
    }
    return false
}

const buyHive = () => {
    globalState.lastBuyTimeHive = new Date().getTime();

    let sellAmount = `${tradeSize} HBD`
    let receiveAmount = `${round(tradeSize / globalState.candleDataBase1[globalState.candleDataBase1.length - 1].close, 3)} HIVE`

    try {
        hive.api.getDynamicGlobalProperties(function(err, result) {
            if (result) {
                hive.broadcast.limitOrderCreate(pKey, username, globalState.hiveBuyCounter + 100, sellAmount, receiveAmount, false, new Date(new Date(result.time).getTime() + 180000 + ((Math.abs(new Date().getTimezoneOffset()) * 1000) * 60)), function(err, result) {
                    globalState.hiveBuyCounter++
                });
            }
        }); 
    } catch (error) {
        globalState.hiveBuyErrors++;
    }
}

const buyHbd = () => {
    globalState.lastBuyTimeHbd = new Date().getTime();

    let sellAmount = `${tradeSize} HIVE`
    let receiveAmount = `${round(globalState.candleDataBase2[globalState.candleDataBase2.length - 1].close * tradeSize, 3)} HBD`

    try {
        hive.api.getDynamicGlobalProperties(function(err, result) {
            if (result) {
                hive.broadcast.limitOrderCreate(pKey, username, globalState.hbdBuyCounter + 1000, sellAmount, receiveAmount, false, new Date(new Date(result.time).getTime() + 180000 + ((Math.abs(new Date().getTimezoneOffset()) * 1000) * 60)), function(err, result) {
                    globalState.hbdBuyCounter++
                });
            }
        });
    } catch (error) {
        globalState.hbdBuyErrors++;
    }
}

const generatePriceLists = () => {
    if (globalState.candleCounter > 0) {
        globalState.closePriceList.hive = [];
        globalState.closePriceList.hbd = [];

        for (i of globalState.candleDataBase1) {
            globalState.closePriceList.hive.push(i.close)
        }

        for (i of globalState.candleDataBase2) {
            globalState.closePriceList.hbd.push(i.close)
        }
    }
}

const createCandle = () => {
    globalState.candleCounter++;
    globalState.candleDataBase1.push({
        open : globalState.tempPriceHolder1[0],
        high : Math.max(...globalState.tempPriceHolder1),
        close : globalState.tempPriceHolder1[globalState.tempPriceHolder1.length -1],
        low : Math.min(...globalState.tempPriceHolder1)
    })

    globalState.candleDataBase2.push({
        open : globalState.tempPriceHolder2[0],
        high : Math.max(...globalState.tempPriceHolder2),
        close : globalState.tempPriceHolder2[globalState.tempPriceHolder2.length -1],
        low : Math.min(...globalState.tempPriceHolder2)
    })

    globalState.tempPriceHolder1 = [];
    globalState.tempPriceHolder2 = [];

    generatePriceLists();
    generateSignals();
    
    console.log(`Candle created! #${globalState.candleCounter}`)
    console.log('----------------------')
}

const generateSignals = () => {
    globalState.emaListHive = ema(globalState.closePriceList.hive, 100);
    globalState.emaListHbd = ema(globalState.closePriceList.hbd, 100);
    globalState.macdListHive = macd(globalState.closePriceList.hive, 12, 26, 9);
    globalState.macdListHbd = macd(globalState.closePriceList.hbd, 12, 26, 9);

    globalState.lastEmaHive = globalState.emaListHive[globalState.emaListHive.length - 1];
    globalState.lastEmaHbd = globalState.emaListHbd[globalState.emaListHbd.length - 1];

    globalState.lastMacHive = globalState.macdListHive[globalState.macdListHive.length - 1];
    globalState.prevMacHive = globalState.macdListHive[globalState.macdListHive.length - 2];

    globalState.lastMacHbd = globalState.macdListHbd[globalState.macdListHbd.length - 1];
    globalState.prevMacHbd = globalState.macdListHbd[globalState.macdListHbd.length - 2];
}

const updatePrice = () => {
    new Promise(() => {
        setTimeout( async () => {
            logProgress();
            globalState.lastUpdate = new Date().getTime()
            globalState.updateCounter++;

            if (globalState.lastUpdate - globalState.lastCandleCreated >= (candleSize * 60) * 1000) {
                createCandle()
                globalState.lastCandleCreated = globalState.lastUpdate;
            }

            if (globalState.candleDataBase1.length == candleLimit + 1) {
                globalState.candleDataBase1.shift();
                globalState.candleDataBase2.shift();

                globalState.closePriceList.hive.shift();
                globalState.closePriceList.hbd.shift();
            }

            if (globalState.emaListHive.length > 25) {
                globalState.emaListHive = globalState.emaListHive.slice(Math.max(globalState.emaListHive.length - 25, 1));
            }
            if (globalState.emaListHbd.length > 25) {
                globalState.emaListHbd = globalState.emaListHbd.slice(Math.max(globalState.emaListHbd.length - 25, 1));
            }
            if (globalState.macdListHive.length > 25) {
                globalState.macdListHive = globalState.macdListHive.slice(Math.max(globalState.macdListHive.length - 25, 1));
            }
            if (globalState.macdListHbd.length > 25) {
                globalState.macdListHbd = globalState.macdListHbd.slice(Math.max(globalState.macdListHbd.length - 25, 1));
            }

            try {
                hive.api.getTicker(function(err, data) {
                    if (data) {
                        globalState.tempPriceHolder1.push(Number(data.lowest_ask))
                        globalState.priceTicker.lowestAsk = Number(data.lowest_ask)

                        globalState.tempPriceHolder2.push(Number(data.highest_bid))
                        globalState.priceTicker.highestBid = Number(data.highest_bid)
                    } else {
                        globalState.priceUpdateErrors++;
                    }
                });
            } catch (error) {
                globalState.priceUpdateErrors++;
            }

            if (globalState.emaListHive.length > 2 && globalState.emaListHbd.length > 2
                && !isNaN(globalState.lastEmaHive) && !isNaN(globalState.lastEmaHbd)) {
                    globalState.tradeStatus = 'Now trading!'

                    if (tradingAlgo(globalState.lastEmaHive, globalState.lastMacHive, globalState.prevMacHive, globalState.candleDataBase1[globalState.candleDataBase1.length - 1])
                    && (globalState.lastUpdate - globalState.lastBuyTimeHive) / 1000 >= 180) {
                        buyHive();
                    }

                    if (tradingAlgo(globalState.lastEmaHbd, globalState.lastMacHbd, globalState.prevMacHbd, globalState.candleDataBase2[globalState.candleDataBase2.length - 1])
                    && (globalState.lastUpdate - globalState.lastBuyTimeHbd) / 1000 >= 180) {
                        buyHbd();
                    }
            }

            updatePrice();
        }, updateRate * 1000)
    })
}

const main = () => {
    globalState.startingTime = new Date().getTime()
    globalState.lastUpdate = globalState.startingTime;
    globalState.lastCandleCreated = globalState.startingTime;

    console.log('Starting...')
    updatePrice();
}

main();
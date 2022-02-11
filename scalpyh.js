const fs = require('fs');
const hive = require('@hiveio/hive-js');
const { 
    updateRate, candleSize, candleLimit, tradeSize, username, pKey, bKey
} = JSON.parse(fs.readFileSync('./settings.json'));
const EMA = require('technicalindicators').EMA;
const MACD = require('technicalindicators').MACD;

let globalState = {
    updateCounter : 0,
    candleCounter : 0,
    priceUpdateErrors : 0,
    tradeStatus : false,

    prevAsk : 0,
    prevBid : 0,

    priceTicker : 0,

    candleDataBase : [],
    tempRealpriceChangeHolder : [],

    closePriceList : [],

    emaList : [],
    macdList : [],

    lastBuyTime : new Date().getTime(),

    hiveBuyCounter : 0,
    hiveBuyErrors : 0,

    hbdBuyCounter : 0,
    hbdBuyErrors : 0
};

//Helpers:
const round = (value, decimals) => {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
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

const countDecimals = (value) => {
    let text = value.toString()

    if (text.indexOf('e-') > -1) {
      let [base, trail] = text.split('e-');
      let deg = parseInt(trail, 10);
      return deg;
    }

    if (Math.floor(value) !== value) {
      return value.toString().split(".")[1].length || 0;
    }
    return 0;
}

const logProgress = () => {
    console.log(`* Price updated (#${globalState.updateCounter})! - Current candles: ${globalState.candleDataBase.length} / ${candleLimit} (Price check errors: ${globalState.priceUpdateErrors})`)
    console.log(`* Trade status: ${globalState.tradeStatus} ==> Hive buy count: ${globalState.hiveBuyCounter}(${globalState.hiveBuyErrors} errors) - Hbd buy count: ${globalState.hbdBuyCounter}(${globalState.hbdBuyErrors} errors)`)
    console.log(`Price ticker: ${globalState.priceTicker}`)
    console.log('----------------------')
}

const reportToMaster = () => {
    const json = JSON.stringify({
        candlesCreated : globalState.candleCounter,
        currentCandles : globalState.candleDataBase.length,
        priceCheckErrors : globalState.priceUpdateErrors,
        tradeStatus : globalState.tradeStatus,
        hiveBuyTicker : globalState.hiveBuyCounter,
        hiveBuyErrors : globalState.hiveBuyErrors,
        hbdBuyTicker : globalState.hbdBuyCounter,
        hbdBuyErrors : globalState.hbdBuyErrors
    });

    try {
        hive.broadcast.customJson(bKey, [], [username], `${username}-scalpyh-report`, json, function(err, result) {
            if (err) {
            } else {
            }
        });
    } catch (error) {
    }
}


//Candles + signals:
const generatePriceLists = () => {
    if (globalState.candleCounter > 0) {
        globalState.closePriceList = [];

        for (i of globalState.candleDataBase) {
            globalState.closePriceList.push(i.close)
        }
    }
}

const createCandle = () => {
    globalState.candleCounter++;
    globalState.candleDataBase.push({
        open : Number(globalState.tempRealpriceChangeHolder[0]),
        high : Math.max(...globalState.tempRealpriceChangeHolder),
        close : Number(globalState.tempRealpriceChangeHolder[globalState.tempRealpriceChangeHolder.length -1]),
        low : Math.min(...globalState.tempRealpriceChangeHolder)
    })

    globalState.tempRealpriceChangeHolder = [];

    generatePriceLists();
    generateSignals();
    
    console.log(`Candle created! #${globalState.candleCounter}`)
    console.log('----------------------')

    if (globalState.candleCounter % 30 == 0) {
        reportToMaster();
    }
}

const generateSignals = () => {
    globalState.emaList = ema(globalState.closePriceList, 100);
    globalState.macdList = macd(globalState.closePriceList, 12, 26, 9);

    globalState.lastEma = globalState.emaList[globalState.emaList.length - 1];
    globalState.lastMac = globalState.macdList[globalState.macdList.length - 1];
    globalState.prevMac = globalState.macdList[globalState.macdList.length - 2];
}

const pushToTemp = (data) => {
    globalState.lastAsk = Number(data.lowest_ask);
    globalState.lastBid = Number(data.highest_bid);

    if (globalState.lastAsk > globalState.prevAsk || globalState.lastAsk < globalState.prevAsk) {
        globalState.prevAsk = globalState.lastAsk;
        globalState.priceTicker = globalState.lastAsk;
        globalState.tempRealpriceChangeHolder.push(globalState.lastAsk);
    }
    else if (globalState.lastBid > globalState.prevBid || globalState.lastBid < globalState.prevBid) {
        globalState.prevBid = globalState.lastBid;
        globalState.priceTicker = globalState.lastBid;
        globalState.tempRealpriceChangeHolder.push(globalState.lastBid);
    }
    else if ((globalState.lastAsk > globalState.prevAsk || globalState.lastAsk < globalState.prevAsk)
        && (globalState.lastBid > globalState.prevBid || globalState.lastBid < globalState.prevBid)) {
        
        globalState.prevAsk = globalState.lastAsk;
        globalState.prevBid = globalState.lastBid;
        globalState.priceTicker = globalState.lastAsk;
        globalState.tempRealpriceChangeHolder.push(globalState.lastAsk);
    }
    else {
        if (globalState.updateCounter == 1) {
            globalState.priceTicker = globalState.lastAsk
            globalState.tempRealpriceChangeHolder.push(globalState.lastAsk);
        } else {
            globalState.tempRealpriceChangeHolder.push(globalState.lastAsk);
        }
    }
}


//Algo(s):
const tradingAlgo = (prevEma, prevmacd, prev2macd, preCandle) => {
    if ( parseFloat(preCandle.close) > parseFloat(prevEma)
        && parseFloat(prevmacd.MACD) > parseFloat(prevmacd.signal)
        && parseFloat(prev2macd.MACD) < parseFloat(prev2macd.signal) && parseFloat(prev2macd.MACD) < 0
        ) {
        return true;
    }
    return false
}

const tradingAlgoSell = (prevEma, prevmacd, prev2macd, preCandle) => {
    if ( parseFloat(preCandle.close) < parseFloat(prevEma)
        && parseFloat(prevmacd.MACD) < parseFloat(prevmacd.signal)
        && parseFloat(prev2macd.MACD) > parseFloat(prev2macd.signal) && parseFloat(prev2macd.MACD) > 0
        ) {
        return true;
    }
    return false
}


//Trading:
const buyHive = () => {
    globalState.lastBuyTimeHive = new Date().getTime();

    let sellAmount = `${tradeSize} HBD`

    let xamount = round(tradeSize / globalState.candleDataBase[globalState.candleDataBase.length - 1].close, 3)
    let xdec = countDecimals(xamount);
    let receiveAmount = 0;

    if (xdec == 3) {
        receiveAmount = `${xamount} HIVE`
    } else if (xdec == 2) {
        receiveAmount = `${xamount}0 HIVE`
    } else if (xdec == 1) {
        receiveAmount = `${xamount}00 HIVE`
    }

    try {
        hive.api.getDynamicGlobalProperties(function(err, result) {
            if (result) {
                hive.broadcast.limitOrderCreate(pKey, username, globalState.hiveBuyCounter + 100, sellAmount, receiveAmount, false, new Date(new Date(result.time).getTime() + 600000 + ((Math.abs(new Date().getTimezoneOffset()) * 1000) * 60)), function(err, result) {
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

    let xamount = round(globalState.candleDataBase[globalState.candleDataBase.length - 1].close * tradeSize, 3)
    let xdec = countDecimals(xamount);
    let receiveAmount = 0;

    if (xdec == 3) {
        receiveAmount = `${xamount} HBD`
    } else if (xdec == 2) {
        receiveAmount = `${xamount}0 HBD`
    } else if (xdec == 1) {
        receiveAmount = `${xamount}00 HBD`
    }

    try {
        hive.api.getDynamicGlobalProperties(function(err, result) {
            if (result) {
                hive.broadcast.limitOrderCreate(pKey, username, globalState.hbdBuyCounter + 1000, sellAmount, receiveAmount, false, new Date(new Date(result.time).getTime() + 600000 + ((Math.abs(new Date().getTimezoneOffset()) * 1000) * 60)), function(err, result) {
                    globalState.hbdBuyCounter++
                });
            }
        });
    } catch (error) {
        globalState.hbdBuyErrors++;
    }
}


//Main loop:
const updatePrice = () => {
    new Promise(() => {
        setTimeout( async () => {
            logProgress();
            globalState.lastUpdate = new Date().getTime()
            globalState.updateCounter++;

            if (globalState.lastUpdate - globalState.lastCandleCreated >= (candleSize * 60) * 1000) {
                createCandle()
                globalState.lastCandleCreated = globalState.lastUpdate;
                console.log(globalState.candleDataBase);
            }

            if (globalState.candleDataBase.length == candleLimit + 1) {
                globalState.candleDataBase.shift();
                globalState.closePriceList.shift();
            }

            if (globalState.emaList.length > 10) {
                globalState.emaList = globalState.emaList.slice(Math.max(globalState.emaList.length - 10, 1));
            }

            if (globalState.macdList.length > 10) {
                globalState.macdList = globalState.macdList.slice(Math.max(globalState.macdList.length - 10, 1));
            }

            try {
                hive.api.getTicker(function(err, data) {
                    if (data) {
                        pushToTemp(data);
                    } else {
                        globalState.priceUpdateErrors++;
                    }
                });
            } catch (error) {
                globalState.priceUpdateErrors++;
            }

            if (globalState.emaList.length > 2 && globalState.emaList.length > 2
                && !isNaN(globalState.lastEma) && !isNaN(globalState.lastEma)) {

                globalState.tradeStatus = true;

                if (tradingAlgo(globalState.lastEma, globalState.lastMac, globalState.prevMac, globalState.candleDataBase[globalState.candleDataBase.length - 1])
                && (globalState.lastUpdate - globalState.lastBuyTimeHive) / 1000 >= 180) {
                    buyHive();
                }

                if (tradingAlgoSell(globalState.lastEma, globalState.lastMac, globalState.prevMac, globalState.candleDataBase[globalState.candleDataBase.length - 1])
                && (globalState.lastUpdate - globalState.lastBuyTimeHbd) / 1000 >= 180) {
                    buyHbd();
                }
            }

            updatePrice();
        }, updateRate * 1000)
    })
}


//Start script:
globalState.startingTime = new Date().getTime()
globalState.lastUpdate = globalState.startingTime;
globalState.lastCandleCreated = globalState.startingTime;

console.log('Starting...')
updatePrice();
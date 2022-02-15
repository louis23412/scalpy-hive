const fs = require('fs');
const hive = require('@hiveio/hive-js');
const { updateRate, candleSize, candleLimit, tradeSize, username, pKey, bKey } = JSON.parse(fs.readFileSync('./settings.json'));
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
    highPriceList : [],
    lowPriceList : [],

    emaList : [],
    macdList : [],

    lastBuyTime : new Date().getTime(),

    hiveBuyCounter : 0,
    hiveBuyErrors : 0,
    hiveFlips : 0,
    ppHive : 0,

    hbdBuyCounter : 0,
    hbdBuyErrors : 0,
    hbdFlips : 0,
    ppHbd : 0
};

//Helpers:
const round = (value, decimals) => {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
};

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
    if (globalState.updateCounter != 0) {
        console.log(`* Price updated (#${globalState.updateCounter})! - Current candles: ${globalState.candleDataBase.length} / ${candleLimit} (Price check errors: ${globalState.priceUpdateErrors})`)
        console.log(`* Trade status: ${globalState.tradeStatus} ==> Hive buy count: ${globalState.hiveBuyCounter}(${globalState.hiveBuyErrors} errors) - Hbd buy count: ${globalState.hbdBuyCounter}(${globalState.hbdBuyErrors} errors)`)
        console.log(`* Price ticker: ${globalState.priceTicker}`)
        console.log('----------------------')
    }
}

const reportToMaster = () => {
    const json = JSON.stringify({
        priceCheckErrors : globalState.priceUpdateErrors,
        tradeStatus : globalState.tradeStatus,
        ordersPlaced : globalState.hiveBuyCounter + globalState.hbdBuyCounter + globalState.hiveFlips + globalState.hbdFlips,
        candlesCreated : globalState.candleCounter,
        currentCandles : globalState.candleDataBase.length,

        hive : {
            buys : globalState.hiveBuyCounter,
            buyErrors : globalState.hiveBuyErrors,
            flips : globalState.hiveFlips,
            pp : globalState.ppHive
        },

        hbd : {
            buys : globalState.hbdBuyCounter,
            buyErrors : globalState.hbdBuyErrors,
            flips : globalState.hbdFlips,
            pp : globalState.ppHbd
        }
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

const createCandle = () => {
    globalState.candleCounter++;
    globalState.candleDataBase.push({
        open : Number(globalState.tempRealpriceChangeHolder[0]),
        high : Math.max(...globalState.tempRealpriceChangeHolder),
        close : Number(globalState.tempRealpriceChangeHolder[globalState.tempRealpriceChangeHolder.length -1]),
        low : Math.min(...globalState.tempRealpriceChangeHolder)
    })

    globalState.tempRealpriceChangeHolder = [];

    globalState.closePriceList.push(Number(globalState.candleDataBase[globalState.candleDataBase.length -1].close));
    globalState.highPriceList.push(Number(globalState.candleDataBase[globalState.candleDataBase.length -1].high));
    globalState.lowPriceList.push(Number(globalState.candleDataBase[globalState.candleDataBase.length -1].low));

    if (globalState.candleDataBase.length == candleLimit + 1) {
        globalState.candleDataBase.shift();
        globalState.closePriceList.shift();
        globalState.highPriceList.shift();
        globalState.lowPriceList.shift();
    }

    globalState.lastPeakHigh = Math.max(...globalState.highPriceList.slice(Math.max(globalState.highPriceList.length - 20, 0)));
    globalState.lastPeakLow = Math.min(...globalState.lowPriceList.slice(Math.max(globalState.lowPriceList.length - 20, 0)));

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

    if (globalState.emaList.length > 10) {
        globalState.emaList = globalState.emaList.slice(Math.max(globalState.emaList.length - 10, 1));
    }

    if (globalState.macdList.length > 10) {
        globalState.macdList = globalState.macdList.slice(Math.max(globalState.macdList.length - 10, 1));
    }

    globalState.lastEma = globalState.emaList[globalState.emaList.length - 1];
    globalState.lastMac = globalState.macdList[globalState.macdList.length - 1];
    globalState.prevMac = globalState.macdList[globalState.macdList.length - 2];
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
const buyHive = (buyQty, sellQty, tp=false, tpTicker=0) => {
    console.log('Buy Hive now')
    globalState.lastBuyTime = new Date().getTime();
    const xdec = countDecimals(buyQty);
    const xdec2 = countDecimals(sellQty);

    let sellAmount = '';
    if (xdec == 3) {
        sellAmount = `${buyQty} HBD`;
    } else if (xdec == 2) {
        sellAmount = `${buyQty}0 HBD`;
    } else if (xdec == 1) {
        sellAmount = `${buyQty}00 HBD`;
    } else if (xdec == 0) {
        sellAmount = `${buyQty}.000 HBD`;
    }

    let receiveAmount = '';
    if (xdec2 == 3) {
        receiveAmount = `${sellQty} HIVE`
    } else if (xdec2 == 2) {
        receiveAmount = `${sellQty}0 HIVE`
    } else if (xdec2 == 1) {
        receiveAmount = `${sellQty}00 HIVE`
    } else if (xdec2 == 0) {
        receiveAmount = `${buyQty}.000 HIVE`;
    }

    try {
        hive.api.getDynamicGlobalProperties(function(err, result) {
            if (result) {
                hive.broadcast.limitOrderCreate(pKey, username, Math.floor(100000 + Math.random() * 900000), sellAmount, receiveAmount, false, new Date(new Date(result.time).getTime() + 86400000 + ((Math.abs(new Date().getTimezoneOffset()) * 1000) * 60)), function(err, result) {
                    if (err) {
                        globalState.hiveBuyErrors++;
                    } else {
                        if (tp == true) {
                            globalState.hiveBuyCounter++;
                            try {
                                buyHbd(sellQty, buyQty + tpTicker)
                                globalState.ppHbd += tpTicker;
                            } catch (error) {
                            }
                        } else {
                            globalState.hiveFlips++;
                        }
                    }
                });
            }
        }); 
    } catch (error) {
        globalState.hiveBuyErrors++;
    }
}

const buyHbd = (buyQty, sellQty, tp=false, tpTicker=0) => {
    console.log('Buy Hbd now')
    globalState.lastBuyTime = new Date().getTime();
    const xdec = countDecimals(buyQty);
    const xdec2 = countDecimals(sellQty);

    let sellAmount = '';
    if (xdec == 3) {
        sellAmount = `${buyQty} HIVE`;
    } else if (xdec == 2) {
        sellAmount = `${buyQty}0 HIVE`;
    } else if (xdec == 1) {
        sellAmount = `${buyQty}00 HIVE`;
    } else if (xdec == 0) {
        sellAmount = `${buyQty}.000 HIVE`;
    }

    let receiveAmount = '';
    if (xdec2 == 3) {
        receiveAmount = `${sellQty} HBD`
    } else if (xdec2 == 2) {
        receiveAmount = `${sellQty}0 HBD`
    } else if (xdec2 == 1) {
        receiveAmount = `${sellQty}00 HBD`
    } else if (xdec2 == 0) {
        receiveAmount = `${buyQty}.000 HBD`;
    }

    try {
        hive.api.getDynamicGlobalProperties(function(err, result) {
            if (result) {
                hive.broadcast.limitOrderCreate(pKey, username, Math.floor(100000 + Math.random() * 900000), sellAmount, receiveAmount, false, new Date(new Date(result.time).getTime() + 86400000 + ((Math.abs(new Date().getTimezoneOffset()) * 1000) * 60)), function(err, result) {
                    if (err) {
                        globalState.hbdBuyErrors++;
                    } else {
                        if (tp == true) {
                            globalState.hbdBuyCounter++;
                            try {
                                buyHive(sellQty, buyQty + tpTicker)
                                globalState.ppHive += tpTicker;
                            } catch (error) {  
                            }
                        } else {
                            globalState.hbdFlips++;
                        }
                    }
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
                && (globalState.lastUpdate - globalState.lastBuyTime) / 1000 >= 180) {
                    const buyQty = round(tradeSize / globalState.candleDataBase[globalState.candleDataBase.length - 1].close, 3);
                    const tpIncreasePercent = (globalState.lastPeakHigh - globalState.candleDataBase[globalState.candleDataBase.length - 1].close) / globalState.candleDataBase[globalState.candleDataBase.length - 1].close;
                    let tpTicker = round(buyQty * tpIncreasePercent, 3);
    
                    if (tpTicker < 0.001) {
                        tpTicker = 0.001
                    }

                    try {
                        buyHive(tradeSize, buyQty, true, tpTicker);
                    } catch (error) {
                    }
                }

                if (tradingAlgoSell(globalState.lastEma, globalState.lastMac, globalState.prevMac, globalState.candleDataBase[globalState.candleDataBase.length - 1])
                && (globalState.lastUpdate - globalState.lastBuyTime) / 1000 >= 180) {
                    const buyQty = round(globalState.candleDataBase[globalState.candleDataBase.length - 1].close * tradeSize, 3);
                    const tpIncreasePercent = (globalState.candleDataBase[globalState.candleDataBase.length - 1].close - globalState.lastPeakLow) / globalState.candleDataBase[globalState.candleDataBase.length - 1].close
                    let tpTicker = round(buyQty * tpIncreasePercent, 3);
    
                    if (tpTicker < 0.001) {
                        tpTicker = 0.001
                    }

                    try {
                        buyHbd(tradeSize, buyQty, true, tpTicker);
                    } catch (error) {
                    }
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
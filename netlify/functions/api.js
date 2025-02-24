const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const chatId = process.env.TELEGRAM_CHAT_ID;

let tokens = [];
let price_updates = {};
let running = false;
let websocket = null;
let alerts = [];

function send_telegram_notification(message) {
    return telegramBot.sendMessage(chatId, message);
}

async function get_sol_usd_rate() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        return response.data.solana.usd || 150;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erreur taux SOL/USD : ${error.message}`);
        return 150;
    }
}

async function check_if_raydium(ca) {
    try {
        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
        return response.data.pairs && response.data.pairs.some(pair => pair.dexId === "raydium");
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erreur vérif Raydium : ${error.message}`);
        return false;
    }
}

async function get_price_from_dexscreener(ca) {
    try {
        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
        const raydiumPair = response.data.pairs && response.data.pairs.find(pair => pair.dexId === "raydium");
        const price = raydiumPair ? parseFloat(raydiumPair.priceUsd) : null;
        console.log(`[${new Date().toISOString()}] Prix Raydium pour ${ca} : ${price}`);
        return price;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erreur Dexscreener : ${error.message}`);
        return null;
    }
}

async function websocket_listener() {
    const uri = "wss://pumpportal.fun/api/data";
    const sol_usd_rate = await get_sol_usd_rate();
    websocket = new WebSocket(uri);

    websocket.on('open', () => {
        console.log(`[${new Date().toISOString()}] Connexion WebSocket ouverte à ${uri}`);
        const pumpfun_tokens = tokens.filter(token => !token.is_raydium).map(token => token.ca);
        if (pumpfun_tokens.length) {
            const payload = { method: "subscribeTokenTrade", keys: pumpfun_tokens };
            websocket.send(JSON.stringify(payload));
            console.log(`[${new Date().toISOString()}] Abonnement WebSocket : ${JSON.stringify(payload)}`);
        }
    });

    websocket.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] WebSocket reçu : ${JSON.stringify(data)}`);
            if (data.solAmount && data.tokenAmount && data.mint) {
                const ca = data.mint;
                const sol_amount = parseFloat(data.solAmount);
                const token_amount = parseFloat(data.tokenAmount);
                if (token_amount > 0) {
                    const price = sol_amount / token_amount;
                    const price_usd = price * sol_usd_rate;
                    price_updates[ca] = price_usd;
                    console.log(`[${timestamp}] Prix Pumpfun mis à jour pour ${ca} : ${price_usd}`);
                    tokens.filter(token => token.ca === ca && !token.is_raydium).forEach(token => {
                        token.price = price_usd;
                        const display_text = token.name || ca.substring(0, 10) + "...";
                        if (token.threshold_high && price_usd >= token.threshold_high && !token.high_alert_sent) {
                            console.log(`[${timestamp}] Seuil haut dépassé pour ${display_text} !`);
                            const alertMsg = `[${timestamp}] Haut - ${display_text}: ${price_usd.toFixed(6)} $ (Seuil: ${token.threshold_high.toFixed(6)} $)`
                            alerts.push(alertMsg);
                            send_telegram_notification(`Le prix de ${token.name || token.ca} a dépassé ${token.threshold_high.toFixed(6)} $ ! Actuel : ${price_usd.toFixed(6)} $`);
                            token.high_alert_sent = true;
                        } else if (token.threshold_low && price_usd <= token.threshold_low && !token.low_alert_sent) {
                            console.log(`[${timestamp}] Seuil bas atteint pour ${display_text} !`);
                            const alertMsg = `[${timestamp}] Bas - ${display_text}: ${price_usd.toFixed(6)} $ (Seuil: ${token.threshold_low.toFixed(6)} $)`;
                            alerts.push(alertMsg);
                            send_telegram_notification(`Le prix de ${token.name || token.ca} est tombé sous ${token.threshold_low.toFixed(6)} $ ! Actuel : ${price_usd.toFixed(6)} $`);
                            token.low_alert_sent = true;
                        }
                        if (token.threshold_high && token.threshold_low && token.threshold_low < price_usd < token.threshold_high) {
                            token.high_alert_sent = false;
                            token.low_alert_sent = false;
                        }
                    });
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Erreur parsing WebSocket : ${error.message}`);
        }
    });

    websocket.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] Erreur WebSocket : ${error.message}`);
    });

    websocket.on('close', () => {
        console.log(`[${new Date().toISOString()}] Connexion WebSocket fermée`);
        if (running) setTimeout(websocket_listener, 5000);
    });
}

function check_prices_raydium() {
    const interval = setInterval(async () => {
        if (!running) {
            clearInterval(interval);
            return;
        }
        for (const token of tokens.filter(t => t.is_raydium)) {
            try {
                const price_usd = await get_price_from_dexscreener(token.ca);
                if (price_usd !== null) {
                    token.price = price_usd;
                    price_updates[token.ca] = price_usd;
                    console.log(`[${new Date().toISOString()}] Prix Raydium appliqué pour ${token.ca} : ${price_usd}`);
                    const display_text = token.name || token.ca.substring(0, 10) + "...";
                    const timestamp = new Date().toISOString();
                    if (token.threshold_high && price_usd >= token.threshold_high && !token.high_alert_sent) {
                        console.log(`[${timestamp}] Seuil haut dépassé pour ${display_text} !`);
                        const alertMsg = `[${timestamp}] Haut - ${display_text}: ${price_usd.toFixed(6)} $ (Seuil: ${token.threshold_high.toFixed(6)} $)`;
                        alerts.push(alertMsg);
                        send_telegram_notification(`Le prix de ${token.name || token.ca} a dépassé ${token.threshold_high.toFixed(6)} $ ! Actuel : ${price_usd.toFixed(6)} $`);
                        token.high_alert_sent = true;
                    } else if (token.threshold_low && price_usd <= token.threshold_low && !token.low_alert_sent) {
                        console.log(`[${timestamp}] Seuil bas atteint pour ${display_text} !`);
                        const alertMsg = `[${timestamp}] Bas - ${display_text}: ${price_usd.toFixed(6)} $ (Seuil: ${token.threshold_low.toFixed(6)} $)`;
                        alerts.push(alertMsg);
                        send_telegram_notification(`Le prix de ${token.name || token.ca} est tombé sous ${token.threshold_low.toFixed(6)} $ ! Actuel : ${price_usd.toFixed(6)} $`);
                        token.low_alert_sent = true;
                    }
                    if (token.threshold_high && token.threshold_low && token.threshold_low < price_usd < token.threshold_high) {
                        token.high_alert_sent = false;
                        token.low_alert_sent = false;
                    }
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Erreur Raydium pour ${token.ca} : ${error.message}`);
            }
        }
    }, 250);
}

exports.handler = async (event, context) => {
    const path = event.path.replace('/.netlify/functions/api', '');
    try {
        if (event.httpMethod === 'POST' && path === '/start_tracking') {
            if (!running) {
                running = true;
                try {
                    websocket_listener();
                    check_prices_raydium();
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Erreur dans websocket_listener/check_prices_raydium : ${error.message}`);
                    throw error;
                }
                console.log(`[${new Date().toISOString()}] Démarrage du suivi pour ${tokens.length} tokens`);
            } else {
                console.log(`[${new Date().toISOString()}] Suivi déjà en cours`);
            }
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        if (event.httpMethod === 'POST' && path === '/add_token') {
            const data = JSON.parse(event.body || '{}');
            const ca = data.ca;
            const name = data.name;
            const threshold_high = data.threshold_high ? parseFloat(data.threshold_high) : null;
            const threshold_low = data.threshold_low ? parseFloat(data.threshold_low) : null;
            if (!ca) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "Contract Address requis" })
                };
            }
            if (threshold_high && threshold_low && threshold_low >= threshold_high) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "Seuil bas doit être inférieur au seuil haut" })
                };
            }
            tokens.push({
                ca: ca,
                name: name,
                threshold_high: threshold_high,
                threshold_low: threshold_low,
                price: null,
                is_raydium: await check_if_raydium(ca),
                high_alert_sent: false,
                low_alert_sent: false
            });
            console.log(`[${new Date().toISOString()}] Token ajouté : ${ca}`);
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        if (event.httpMethod === 'POST' && path === '/stop_tracking') {
            running = false;
            if (websocket) websocket.close();
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        if (event.httpMethod === 'POST' && path === '/remove_token') {
            const data = JSON.parse(event.body || '{}');
            const index = parseInt(data.index, 10);
            if (isNaN(index) || index < 0 || index >= tokens.length) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: "Index invalide" })
                };
            }
            tokens.splice(index, 1);
            console.log(`[${new Date().toISOString()}] Token supprimé à l’index ${index}`);
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true })
            };
        }
        if (event.httpMethod === 'GET' && path === '/get_tokens') {
            console.log(`[${new Date().toISOString()}] Renvoi des tokens : ${JSON.stringify(tokens)}`);
            return {
                statusCode: 200,
                body: JSON.stringify(tokens)
            };
        }
        if (event.httpMethod === 'GET' && path === '/get_alerts') {
            return {
                statusCode: 200,
                body: JSON.stringify(alerts.slice(-10))
            };
        }
        return {
            statusCode: 404,
            body: JSON.stringify({ error: "Route non trouvée" })
        };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erreur dans ${path} : ${error.message}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Erreur interne : " + error.message })
        };
    }
};
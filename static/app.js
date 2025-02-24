let selectedIndex = null;
let lastTokensState = [];

async function addToken() {
    const ca = document.getElementById("ca").value;
    const name = document.getElementById("name").value;
    const threshold_high = document.getElementById("threshold_high").value;
    const threshold_low = document.getElementById("threshold_low").value;
    try {
        const response = await fetch('/.netlify/functions/api/add_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ca, name, threshold_high, threshold_low })
        });
        const data = await response.json();
        console.log("Réponse add_token:", data);
        if (response.ok) {
            updateTable();
            clearInputs();
        } else {
            alert(data.error || "Erreur inconnue lors de l'ajout du token");
        }
    } catch (error) {
        console.error("Erreur réseau add_token:", error);
        alert("Erreur réseau : " + error.message);
    }
}

async function editToken() {
    if (selectedIndex === null) return alert("Sélectionnez un token à modifier");
    const ca = document.getElementById("ca").value;
    const name = document.getElementById("name").value;
    const threshold_high = document.getElementById("threshold_high").value;
    const threshold_low = document.getElementById("threshold_low").value;
    try {
        const response = await fetch(`/.netlify/functions/api/edit_token/${selectedIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ca, name, threshold_high, threshold_low })
        });
        const data = await response.json();
        console.log("Réponse edit_token:", data);
        if (response.ok) {
            updateTable();
            clearInputs();
            document.getElementById("editButton").disabled = true;
            selectedIndex = null;
        } else {
            alert(data.error || "Erreur inconnue lors de la modification");
        }
    } catch (error) {
        console.error("Erreur réseau edit_token:", error);
        alert("Erreur réseau : " + error.message);
    }
}

async function removeToken(index) {
    try {
        const response = await fetch('/.netlify/functions/api/remove_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index })
        });
        const data = await response.json();
        console.log("Réponse remove_token:", data, "Statut:", response.status);
        if (response.ok) {
            updateTable();
            clearInputs();
            document.getElementById("editButton").disabled = true;
            selectedIndex = null;
        } else {
            alert(data.error || "Erreur inconnue lors de la suppression");
        }
    } catch (error) {
        console.error("Erreur réseau remove_token:", error);
        alert("Erreur réseau : " + error.message + " - Statut: " + (error.status || "inconnu"));
    }
}

async function startTracking() {
    document.getElementById("status").textContent = "Tentative de démarrage...";
    console.log("Bouton Démarrer cliqué - Plateforme :", navigator.userAgent);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.error("Timeout de 60s atteint pour /start_tracking");
            document.getElementById("status").textContent = "Erreur : Timeout réseau";
            document.getElementById("status").style.color = "#ff0000";
            alert("Erreur : La requête a expiré après 60 secondes. Vérifie ta connexion ou réessaie.");
        }, 60000);
        const response = await fetch('/.netlify/functions/api/start_tracking', {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await response.json();
        console.log("Réponse start_tracking:", data, "Statut:", response.status, "URL:", response.url, "Headers:", response.headers);
        alert("Requête envoyée, statut: " + response.status + " - Détail: " + (response.statusText || "Aucun détail") + " - Réponse: " + JSON.stringify(data));
        if (response.ok) {
            document.getElementById("startButton").disabled = true;
            document.getElementById("stopButton").disabled = false;
            document.getElementById("status").textContent = "Statut : Suivi actif";
            document.getElementById("status").style.color = "#00ff00";
            console.log("Tracking démarré");
            updateTablePeriodically();
        } else {
            const errorData = data.error || "Erreur inconnue";
            console.error("Erreur start_tracking:", errorData);
            document.getElementById("status").textContent = "Erreur : " + errorData;
            document.getElementById("status").style.color = "#ff0000";
            alert("Erreur serveur : " + errorData + " - Statut: " + response.status);
        }
    } catch (error) {
        console.error("Erreur réseau lors de start_tracking:", error);
        document.getElementById("status").textContent = "Erreur réseau : " + error.message + " (détail: " + (error.name || "inconnu") + ")";
        document.getElementById("status").style.color = "#ff0000";
        alert("Erreur réseau : " + error.message + " (détail: " + (error.name || "inconnu") + ") - URL: /start_tracking");
    }
}

async function stopTracking() {
    try {
        const response = await fetch('/.netlify/functions/api/stop_tracking', { method: 'POST' });
        const data = await response.json();
        console.log("Réponse stop_tracking:", data);
        if (response.ok) {
            document.getElementById("startButton").disabled = false;
            document.getElementById("stopButton").disabled = true;
            document.getElementById("status").textContent = "Statut : En attente";
            document.getElementById("status").style.color = "#d3d3d3";
            lastTokensState = [];
            clearInterval(updateInterval);
        } else {
            alert(data.error || "Erreur inconnue lors de l'arrêt");
        }
    } catch (error) {
        console.error("Erreur réseau stop_tracking:", error);
        alert("Erreur réseau : " + error.message);
    }
}

async function updateTable() {
    try {
        const response = await fetch('/.netlify/functions/api/get_tokens', {
            method: 'GET'
        });
        const tokens = await response.json();
        console.log("Mise à jour tableau - Réponse get_tokens:", tokens);
        const tbody = document.querySelector("#tokenTable tbody");
        tbody.innerHTML = "";
        
        tokens.forEach((token, index) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${token.name || token.ca.substring(0, 30) + (token.ca.length > 30 ? "..." : "")}</td>
                <td>${token.threshold_high ? token.threshold_high.toFixed(6) : "N/A"}</td>
                <td>${token.threshold_low ? token.threshold_low.toFixed(6) : "N/A"}</td>
                <td>${token.price ? token.price.toFixed(6) : "N/A"}</td>
                <td>
                    <button onclick="selectToken(${index})">Modifier</button>
                    <button onclick="removeToken(${index})">Supprimer</button>
                </td>
            `;
            tbody.appendChild(tr);

            const lastToken = lastTokensState[index] || {};
            const price = token.price;
            const displayText = token.name || token.ca.substring(0, 10) + "...";

            if (price !== null && price !== undefined) {
                // Les notifications système sont supprimées, Telegram gère les alertes côté serveur
                if (token.threshold_high && price >= token.threshold_high && !lastToken.high_alert_sent) {
                    console.log(`Alerte Telegram envoyée pour seuil haut dépassé : ${displayText}`);
                    token.high_alert_sent = true;
                } else if (token.threshold_low && price <= token.threshold_low && !lastToken.low_alert_sent) {
                    console.log(`Alerte Telegram envoyée pour seuil bas atteint : ${displayText}`);
                    token.low_alert_sent = true;
                }
                if (token.threshold_high && token.threshold_low && token.threshold_low < price && price < token.threshold_high) {
                    token.high_alert_sent = false;
                    token.low_alert_sent = false;
                }
            }
        });

        lastTokensState = tokens.map(token => ({ ...token }));
        updateAlerts();
    } catch (error) {
        console.error("Erreur réseau updateTable:", error);
        alert("Erreur réseau lors de la mise à jour du tableau : " + error.message);
    }
}

function selectToken(index) {
    fetch('/.netlify/functions/api/get_tokens').then(response => response.json()).then(tokens => {
        const token = tokens[index];
        document.getElementById("ca").value = token.ca;
        document.getElementById("name").value = token.name || "";
        document.getElementById("threshold_high").value = token.threshold_high || "";
        document.getElementById("threshold_low").value = token.threshold_low || "";
        selectedIndex = index;
        document.getElementById("editButton").disabled = false;
    }).catch(error => {
        console.error("Erreur réseau selectToken:", error);
        alert("Erreur réseau lors de la sélection : " + error.message);
    });
}

async function updateAlerts() {
    try {
        const response = await fetch('/.netlify/functions/api/get_alerts');
        const alerts = await response.json();
        console.log("Réponse get_alerts:", alerts);
        if (Array.isArray(alerts)) {
            const alertList = document.getElementById("alertList");
            alertList.innerHTML = "";
            alerts.forEach(alert => {
                const li = document.createElement("li");
                li.textContent = alert;
                alertList.appendChild(li);
            });
        } else {
            console.error("Les alertes ne sont pas un tableau :", alerts);
            alert("Erreur : Les alertes reçues ne sont pas au format attendu.");
        }
    } catch (error) {
        console.error("Erreur réseau updateAlerts:", error);
        alert("Erreur réseau lors de la mise à jour des alertes : " + error.message);
    }
}

function clearInputs() {
    document.getElementById("ca").value = "";
    document.getElementById("name").value = "";
    document.getElementById("threshold_high").value = "";
    document.getElementById("threshold_low").value = "";
}

let updateInterval = null;

function updateTablePeriodically() {
    if (document.getElementById("stopButton").disabled) {
        console.log("Mise à jour arrêtée car suivi inactif");
        return;
    }
    console.log("Démarrage mise à jour périodique sur", navigator.userAgent);
    updateTable();
    updateInterval = setInterval(() => {
        if (document.getElementById("stopButton").disabled) {
            clearInterval(updateInterval);
            console.log("Mise à jour périodique arrêtée");
            return;
        }
        console.log("Mise à jour tableau en cours...");
        updateTable();
    }, 1000);
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js')
        .then(() => console.log('Service Worker enregistré'))
        .catch(err => console.error('Erreur Service Worker :', err));
}
/**
 * ANOR V17 • Script de Gestion de la Carte de Surveillance & Traçabilité des Flux Réels
 */

let mapInstance = null;
let markersLayer = null;

document.addEventListener("DOMContentLoaded", () => {
    initialiserCarteVide();
    verifierServeurEtCharger();
    
    // Actualisation automatique des données de surveillance toutes les 30 secondes
    setInterval(chargerDonneesSurveillance, 30000);
});

/**
 * Initialise la carte avec un fond sombre 100% libre et sans clé API requise
 */
function initialiserCarteVide() {
    if (mapInstance) {
        mapInstance.remove();
    }

    mapInstance = L.map('map').setView([4.0511, 11.5021], 6);
    
    const osmDarkTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
        subdomains: ['a', 'b', 'c']
    });

    osmDarkTileLayer.addTo(mapInstance);

    setTimeout(() => {
        const pane = mapInstance.getPane('tilePane');
        if (pane) {
            pane.style.filter = 'invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)';
        }
    }, 200);

    markersLayer = L.layerGroup().addTo(mapInstance);
}

/**
 * Vérifie l'état de santé du serveur et déclenche le chargement
 */
async function verifierServeurEtCharger() {
    const dot = document.getElementById("serverDot");
    const text = document.getElementById("serverStatusText");
    const badge = document.getElementById("serverStatusBadge");

    try {
        const res = await fetch('/health');
        if (res.ok) {
            dot.style.background = "var(--accent-green)";
            dot.style.boxShadow = "0 0 8px var(--accent-green)";
            text.textContent = "SURVEILLANCE ACTIVE (BDD CONNECTÉE)";
            badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
            
            await chargerDonneesSurveillance();
        } else {
            throw new Error("Erreur de réponse du serveur");
        }
    } catch (err) {
        dot.style.background = "var(--accent-red)";
        dot.style.boxShadow = "0 0 8px var(--accent-red)";
        text.textContent = "SERVEUR HORS LIGNE / ERREUR API";
        badge.style.color = "var(--accent-red)";
        badge.style.borderColor = "rgba(239, 68, 68, 0.3)";
    }
}

/**
 * Interroge l'API de surveillance pour récupérer les données réelles de la BDD
 */
async function chargerDonneesSurveillance() {
    const region = document.getElementById("regionFilter")?.value || '';
    const statut = document.getElementById("statusFilter")?.value || '';
    const dateDebut = document.getElementById("dateDebut")?.value || '';
    const dateFin = document.getElementById("dateFin")?.value || '';
    
    try {
        const queryParams = new URLSearchParams({
            region: region !== "Toutes les 10 Régions (Cameroun)" ? region : '',
            statut: statut !== "Tous les statuts" ? statut : '',
            dateDebut,
            dateFin
        });

        const response = await fetch(`/api/surveillance/data?${queryParams.toString()}`);
        if (!response.ok) return;

        const json = await response.json();
        if (json.success) {
            if (json.stats) mettreAJourKPIs(json.stats);
            if (json.points) mettreAJourCarte(json.points);
            if (json.alerts) mettreAJourFluxAlertes(json.alerts);
            if (json.history) mettreAJourHistorique(json.history);
        }
    } catch (e) {
        console.error("Erreur lors du chargement des données de surveillance réelles :", e);
    }
}

function mettreAJourKPIs(stats) {
    if (!stats) return;
    const elScans = document.getElementById("kpiScans");
    const elInspecteurs = document.getElementById("kpiInspecteurs");
    const elAlertes = document.getElementById("kpiAlertes");
    const elProduits = document.getElementById("kpiProduits");

    if (elScans) elScans.textContent = stats.scans || "0";
    if (elInspecteurs) elInspecteurs.textContent = stats.inspecteurs || "0";
    if (elAlertes) elAlertes.textContent = stats.alertes || "0";
    if (elProduits) elProduits.textContent = stats.produits || "0";
}

/**
 * Dessine les points et cercles concentriques de zones de scan sur la carte
 * selon leur état exact (Vert : Conforme, Jaune : Douteux/Doublon, Rouge : Défectueux/Alerte)
 */
function mettreAJourCarte(points) {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    if (!points || points.length === 0) return;

    points.forEach(p => {
        let couleur = '#10b981'; // 🟢 Vert par défaut (Scan bien vert / Conforme)
        
        if (p.type === 'DOUBLON_RAPIDE' || p.type === 'SOUS SURVEILLANCE' || p.color === 'yellow') {
            couleur = '#f59e0b'; // 🟡 Jaune (Scan douteux / Attention)
        } else if (p.type === 'ALERTE' || p.type === 'CONTREFAÇON' || p.type === 'ALERTE_TRICHE_GEOGRAPHIQUE' || p.color === 'red') {
            couleur = '#ef4444'; // 🔴 Rouge (Scan défectueux / Alerte)
        }
        
        // Cercle concentrique de zone de scan
        const zoneCircle = L.circle(p.coords, {
            radius: 12000, 
            color: couleur,
            fillColor: couleur,
            fillOpacity: 0.22,
            weight: 1.8
        });

        const marker = L.circleMarker(p.coords, {
            radius: 7,
            color: '#ffffff',
            fillColor: couleur,
            fillOpacity: 1,
            weight: 2
        });

        marker.bindPopup(`
            <div style="color:#0f172a; font-family:sans-serif; padding: 6px; min-width: 160px;">
                <strong style="font-size: 14px; color: #1e293b;">${p.nom}</strong><br>
                <p style="margin: 6px 0; font-size: 12px; color: #475569;">${p.details || ''}</p>
                <div style="margin-top: 4px;">
                    <span style="display:inline-block; padding: 3px 8px; border-radius: 4px; background: ${couleur}; color: #fff; font-weight: bold; font-size: 11px;">
                        STATUT : ${p.type}
                    </span>
                </div>
            </div>
        `);

        markersLayer.addLayer(zoneCircle);
        markersLayer.addLayer(marker);
    });
}

function mettreAJourFluxAlertes(alerts) {
    const container = document.getElementById("alertFeedContainer");
    if (!container) return;
    
    if (!alerts || alerts.length === 0) {
        container.innerHTML = `<div class="feed-item"><div class="title">Aucune alerte active sur le réseau</div><div class="meta"><span>Système ANOR</span><span>En direct</span></div></div>`;
        return;
    }

    container.innerHTML = alerts.map(a => `
        <div class="feed-item ${a.niveau || 'normal'}">
            <div class="title">${a.titre}</div>
            <div class="meta"><span>${a.source}</span><span>${a.temps}</span></div>
        </div>
    `).join('');
}

function mettreAJourHistorique(history) {
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b;">Aucun historique de scan disponible pour le moment.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = history.map(h => `
        <tr>
            <td>${h.date}</td>
            <td>${h.produit}</td>
            <td><strong>${h.lot}</strong></td>
            <td>${h.entreprise}</td>
            <td>${h.ville}</td>
            <td>${h.region}</td>
            <td>${h.inspecteur}</td>
            <td><span class="badge-statut ${h.resultat === 'CONFORME' ? 'conforme' : 'alerte'}">${h.resultat}</span></td>
        </tr>
    `).join('');
}
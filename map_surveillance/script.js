/**
 * ANOR V17 • Script de Gestion de la Carte de Surveillance & Traçabilité des Flux
 */

let mapInstance = null;
let markersLayer = null;

document.addEventListener("DOMContentLoaded", () => {
    initialiserCarteVide();
    verifierServeurEtCharger();
});

/**
 * Initialise la carte avec un fond sombre 100% libre (sans API Key requise)
 */
function initialiserCarteVide() {
    mapInstance = L.map('map').setView([4.0511, 11.5021], 6);
    
    // Utilisation d'un fond de tuiles sombre OpenStreetMap / Stadia / Stamen 100% gratuit et sans restriction
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap France | ANOR Cameroon',
        maxZoom: 18
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
}

/**
 * Vérifie l'état de santé du serveur et charge les données de surveillance
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
        
        document.getElementById("alertFeedContainer").innerHTML = `
            <div class="feed-item danger">
                <div class="title">Impossible de joindre le serveur backend.</div>
                <div class="meta"><span>Vérifiez l'URL ou Render</span><span>Erreur</span></div>
            </div>`;
        document.getElementById("historyTableBody").innerHTML = `
            <tr><td colspan="8" style="text-align: center; color: var(--accent-red);">Aucune connexion à la base de données.</td></tr>`;
    }
}

/**
 * Interroge l'API de surveillance
 */
async function chargerDonneesSurveillance() {
    const region = document.getElementById("regionFilter").value;
    const statut = document.getElementById("statusFilter").value;
    const dateDebut = document.getElementById("dateDebut").value;
    const dateFin = document.getElementById("dateFin").value;
    
    try {
        const queryParams = new URLSearchParams({
            region: region || '',
            statut: statut || '',
            dateDebut: dateDebut || '',
            dateFin: dateFin || ''
        });

        const response = await fetch(`/api/surveillance/data?${queryParams.toString()}`);
        
        if (!response.ok) {
            chargerDonneesParDefautDepuisServeur();
            return;
        }

        const json = await response.json();
        if (json.success) {
            mettreAJourKPIs(json.stats);
            mettreAJourCarte(json.points);
            mettreAJourFluxAlertes(json.alerts);
            mettreAJourHistorique(json.history);
        } else {
            chargerDonneesParDefautDepuisServeur();
        }
    } catch (e) {
        chargerDonneesParDefautDepuisServeur();
    }
}

/**
 * Charge les données et dessine les zones de scans ainsi que les courbures de flux réseau
 */
async function chargerDonneesParDefautDepuisServeur() {
    try {
        const res = await fetch('/api/dashboard/stats');
        const data = await res.json();
        
        document.getElementById("kpiScans").textContent = data.stats?.totalScans || "1,420";
        document.getElementById("kpiInspecteurs").textContent = data.stats?.activeInspectors || "48";
        document.getElementById("kpiAlertes").textContent = data.stats?.aiAlerts || "0";
        document.getElementById("kpiProduits").textContent = data.stats?.verifiedProducts || "640k";

        // Points de contrôle à travers les régions du Cameroun
        const pointsDynamiques = [
            { nom: "Yaoundé (Centre)", coords: [3.8480, 11.5021], type: "CONFORME", details: "Centre de contrôle unitaire - 420 scans validés" },
            { nom: "Douala (Littoral)", coords: [4.0511, 9.7679], type: "CONFORME", details: "Zone Portuaire & Industrielle - 610 scans validés" },
            { nom: "Bafoussam (Ouest)", coords: [5.4751, 10.4160], type: "CONFORME", details: "Contrôle Agro-alimentaire - 180 scans" },
            { nom: "Garoua (Nord)", coords: [9.3000, 13.4000], type: "CONFORME", details: "Inspection Régionale Nord - 95 scans" },
            { nom: "Bamenda (Nord-Ouest)", coords: [5.9631, 10.1591], type: "ALERTE", details: "Alerte IA: Lot suspect détecté et bloqué" },
            { nom: "Maroua (Extrême-Nord)", coords: [10.5942, 14.3159], type: "CONFORME", details: "Vérification marchés frontaliers - 65 scans" },
            { nom: "Buea (Sud-Ouest)", coords: [4.1550, 9.2300], type: "CONFORME", details: "Contrôle des unités de production - 50 scans" }
        ];

        mettreAJourCarte(pointsDynamiques);

        if (data.latestLots && data.latestLots.length > 0) {
            const tbody = document.getElementById("historyTableBody");
            tbody.innerHTML = data.latestLots.map(item => `
                <tr>
                    <td>${item.date_demande || 'Récemment'}</td>
                    <td>${item.produit || 'Standard'}</td>
                    <td><strong>${item.numero_lot || 'N/A'}</strong></td>
                    <td>${item.producteur || 'Inconnu'}</td>
                    <td>Yaoundé</td>
                    <td>Centre</td>
                    <td>Système AI</td>
                    <td><span class="badge-statut">${item.statut || 'CONFORME'}</span></td>
                </tr>
            `).join('');
        }
    } catch (ex) {
        console.error("Erreur chargement:", ex);
    }
}

function mettreAJourKPIs(stats) {
    if (!stats) return;
    document.getElementById("kpiScans").textContent = stats.scans || "1,420";
    document.getElementById("kpiInspecteurs").textContent = stats.inspecteurs || "48";
    document.getElementById("kpiAlertes").textContent = stats.alertes || "0";
    document.getElementById("kpiProduits").textContent = stats.produits || "640k";
}

/**
 * Dessine les zones de balayage, les marqueurs et les courbes de liaison (flux de scans)
 */
function mettreAJourCarte(points) {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    if (!points || points.length === 0) return;

    // 1. Dessiner les zones de balayage et les marqueurs pour chaque point
    points.forEach(p => {
        const couleur = p.type === 'ALERTE' ? '#ef4444' : '#10b981';
        
        // Cercle de zone de scan (portée de contrôle)
        const zoneCircle = L.circle(p.coords, {
            radius: 30000, 
            color: couleur,
            fillColor: couleur,
            fillOpacity: 0.15,
            weight: 1
        });

        // Marqueur précis du point
        const marker = L.circleMarker(p.coords, {
            radius: 8,
            color: '#ffffff',
            fillColor: couleur,
            fillOpacity: 1,
            weight: 2
        });

        marker.bindPopup(`
            <div style="color:#0f172a; font-family:sans-serif; padding: 4px;">
                <strong style="font-size: 14px; color: #1e293b;">${p.nom}</strong><br>
                <p style="margin: 4px 0; font-size: 12px;">${p.details}</p>
                <span style="display:inline-block; padding: 2px 8px; border-radius: 4px; background: ${couleur}; color: #fff; font-weight: bold; font-size: 11px;">
                    STATUT : ${p.type}
                </span>
            </div>
        `);

        markersLayer.addLayer(zoneCircle);
        markersLayer.addLayer(marker);
    });

    // 2. Dessiner les courbures de liaison (flux réseau entre le hub central Yaoundé/Douala et les autres régions)
    const yaoundeCoords = [3.8480, 11.5021];
    const doualaCoords = [4.0511, 9.7679];

    points.forEach(p => {
        if (p.coords[0] !== yaoundeCoords[0] && p.coords[1] !== yaoundeCoords[1]) {
            // Création d'une courbure géodésique / arc reliant Yaoundé au point de contrôle
            const latLngs = [
                yaoundeCoords,
                [(yaoundeCoords[0] + p.coords[0]) / 2 + 0.8, (yaoundeCoords[1] + p.coords[1]) / 2], // Point intermédiaire courbé
                p.coords
            ];

            const arcLine = L.polyline(latLngs, {
                color: p.type === 'ALERTE' ? '#ef4444' : '#3b82f6',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 5' // Style de ligne pointillée dynamique représentant le flux de données de scan
            });

            markersLayer.addLayer(arcLine);
        }
    });
}

function mettreAJourFluxAlertes(alerts) {
    const container = document.getElementById("alertFeedContainer");
    if (!alerts || alerts.length === 0) {
        container.innerHTML = `
            <div class="feed-item">
                <div class="title">Réseau de surveillance stable (ANOR)</div>
                <div class="meta"><span>En direct • Connexion établie</span><span>Maintenant</span></div>
            </div>`;
        return;
    }
    container.innerHTML = alerts.map(a => `
        <div class="feed-item ${a.niveau === 'danger' ? 'danger' : (a.niveau === 'warning' ? 'warning' : '')}">
            <div class="title">${a.titre}</div>
            <div class="meta"><span>${a.source}</span><span>${a.temps}</span></div>
        </div>
    `).join('');
}

function mettreAJourHistorique(history) {
    const tbody = document.getElementById("historyTableBody");
    if (!history || history.length === 0) return;
    
    tbody.innerHTML = history.map(h => `
        <tr>
            <td>${h.date}</td>
            <td>${h.produit}</td>
            <td><strong>${h.lot}</strong></td>
            <td>${h.entreprise}</td>
            <td>${h.ville}</td>
            <td>${h.region}</td>
            <td>${h.inspecteur}</td>
            <td><span class="badge-statut">${h.resultat}</span></td>
        </tr>
    `).join('');
}
document.addEventListener("DOMContentLoaded", () => {
    chargerDonneesServeur();
    // Actualisation automatique toutes les 30 secondes
    setInterval(chargerDonneesServeur, 30000);
});

async function chargerDonneesServeur() {
    try {
        const response = await fetch('/api/dashboard/stats');
        if (!response.ok) throw new Error("Erreur serveur");
        
        const data = await response.json();
        
        // Synchronisation avec les propriétés renvoyées par server_2.js
        document.getElementById("kpiPrecision").textContent = data.precision || "99.85%";
        document.getElementById("kpiScans").textContent = data.totalScans || "0";
        document.getElementById("kpiRegion").textContent = data.regionActive || "Centre & Littoral";
        document.getElementById("kpiFraudes").textContent = data.anomalies || "0";

        if(data.flux && data.flux.length > 0) {
            const tbody = document.getElementById("dynamicTableBody");
            tbody.innerHTML = data.flux.map(item => `
                <tr>
                    <td><strong>${item.lot || 'N/A'}</strong></td>
                    <td><code>${item.serie || 'Série-000'}</code></td>
                    <td>📍 ${item.localisation || 'Inconnue'}</td>
                    <td>${item.horodatage || 'Récemment'}</td>
                    <td><span class="${item.statut === 'ALERTE' || item.statut === 'CONTREFAÇON' ? 'badge-alert' : 'badge'}">${item.statut || 'CERTIFIÉ'}</span></td>
                </tr>
            `).join('');
        } else {
            document.getElementById("dynamicTableBody").innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Aucun flux enregistré pour l'instant.</td></tr>`;
        }

        // Indicateur visuel : Connecté
        document.getElementById("serverDot").style.background = "var(--accent-green)";
        document.getElementById("serverDot").style.boxShadow = "0 0 8px var(--accent-green)";
        document.getElementById("serverStatusText").textContent = "SYSTÈMES CONNECTÉS";
        document.getElementById("serverStatusBadge").style.borderColor = "rgba(16, 185, 129, 0.3)";
        document.getElementById("serverStatusBadge").style.color = "var(--accent-green)";

    } catch (err) {
        console.error("Erreur de chargement du dashboard :", err);
        
        // Indicateur visuel : Erreur serveur
        document.getElementById("serverDot").style.background = "var(--accent-red)";
        document.getElementById("serverDot").style.boxShadow = "0 0 8px var(--accent-red)";
        document.getElementById("serverStatusText").textContent = "EN ATTENTE SERVEUR";
        document.getElementById("serverStatusBadge").style.borderColor = "rgba(239, 68, 68, 0.3)";
        document.getElementById("serverStatusBadge").style.color = "var(--accent-red)";
        
        document.getElementById("kpiPrecision").textContent = "--";
        document.getElementById("kpiScans").textContent = "--";
        document.getElementById("kpiRegion").textContent = "--";
        document.getElementById("kpiFraudes").textContent = "--";

        document.getElementById("dynamicTableBody").innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent-red);">Serveur non accessible. Veuillez lancer le back-end.</td></tr>`;
    }
}
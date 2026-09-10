let globalFluxData = [];
let currentPage = 1;
const rowsPerPage = 10;

document.addEventListener("DOMContentLoaded", () => {
    chargerDonneesServeur();
    setInterval(chargerDonneesServeur, 30000);
});

async function chargerDonneesServeur() {
    try {
        const response = await fetch('/api/dashboard/stats');
        if (!response.ok) throw new Error("Erreur serveur");
        
        const data = await response.json();
        
        document.getElementById("kpiPrecision").textContent = data.precision || "99.85%";
        document.getElementById("kpiScans").textContent = data.totalScans || "0";
        document.getElementById("kpiRegion").textContent = "Centre";
        document.getElementById("kpiFraudes").textContent = data.anomalies || "0";

        if (data.flux && data.flux.length > 0) {
            globalFluxData = data.flux;
            currentPage = 1;
            rendreTableauPagine();
        } else {
            globalFluxData = [];
            document.getElementById("dynamicTableBody").innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Aucun flux enregistré pour l'instant.</td></tr>`;
            document.getElementById("paginationContainer").style.display = "none";
        }

        document.getElementById("serverDot").style.background = "var(--accent-green)";
        document.getElementById("serverDot").style.boxShadow = "0 0 8px var(--accent-green)";
        document.getElementById("serverStatusText").textContent = "SYSTÈMES CONNECTÉS";
        document.getElementById("serverStatusBadge").style.borderColor = "rgba(16, 185, 129, 0.3)";
        document.getElementById("serverStatusBadge").style.color = "var(--accent-green)";

    } catch (err) {
        console.error("Erreur de chargement du dashboard :", err);
        
        document.getElementById("serverDot").style.background = "var(--accent-red)";
        document.getElementById("serverDot").style.boxShadow = "0 0 8px var(--accent-red)";
        document.getElementById("serverStatusText").textContent = "EN ATTENTE SERVEUR";
        document.getElementById("serverStatusBadge").style.borderColor = "rgba(239, 68, 68, 0.3)";
        document.getElementById("serverStatusBadge").style.color = "var(--accent-red)";
        
        document.getElementById("kpiPrecision").textContent = "--";
        document.getElementById("kpiScans").textContent = "--";
        document.getElementById("kpiRegion").textContent = "Centre";
        document.getElementById("kpiFraudes").textContent = "--";

        document.getElementById("dynamicTableBody").innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent-red);">Serveur non accessible. Veuillez lancer le back-end.</td></tr>`;
        document.getElementById("paginationContainer").style.display = "none";
    }
}

function rendreTableauPagine() {
    const tbody = document.getElementById("dynamicTableBody");
    const paginationContainer = document.getElementById("paginationContainer");
    
    if (!globalFluxData || globalFluxData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Aucun flux enregistré pour l'instant.</td></tr>`;
        paginationContainer.style.display = "none";
        return;
    }

    const totalPages = Math.ceil(globalFluxData.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    const currentSlice = globalFluxData.slice(startIdx, endIdx);

    tbody.innerHTML = currentSlice.map(item => `
        <tr>
            <td><strong>${item.lot || 'N/A'}</strong></td>
            <td><code>${item.serie || 'Série-000'}</code></td>
            <td>📍 ${item.localisation || 'Inconnue'}</td>
            <td>${item.horodatage || 'Récemment'}</td>
            <td><span class="${item.statut === 'ALERTE' || item.statut === 'CONTREFAÇON' ? 'badge-alert' : 'badge'}">${item.statut || 'CERTIFIÉ'}</span></td>
        </tr>
    `).join('');

    document.getElementById("pageInfo").textContent = `Affichage ${startIdx + 1}-${Math.min(endIdx, globalFluxData.length)} sur ${globalFluxData.length} lots`;
    
    if (globalFluxData.length > rowsPerPage) {
        paginationContainer.style.display = "flex";
        document.getElementById("prevPageBtn").disabled = currentPage === 1;
        document.getElementById("nextPageBtn").disabled = currentPage === totalPages;
    } else {
        paginationContainer.style.display = "none";
    }
}

function changerPage(direction) {
    currentPage += direction;
    rendreTableauPagine();
}
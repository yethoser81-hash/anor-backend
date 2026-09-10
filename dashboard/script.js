let globalFluxData = [];
let currentPage = 1;
let rowsPerPage = 10;

document.addEventListener("DOMContentLoaded", () => {
    chargerDonneesServeur();
    setInterval(chargerDonneesServeur, 30000);
});

async function chargerDonneesServeur() {
    try {
        const response = await fetch('/api/dashboard/stats');
        if (!response.ok) throw new Error("Erreur serveur");
        
        let data = await response.json();
        
        document.getElementById("kpiPrecision").textContent = data.precision || "99.85%";
        document.getElementById("kpiScans").textContent = data.totalScans || "22";
        document.getElementById("kpiRegion").textContent = "Centre";
        document.getElementById("kpiFraudes").textContent = data.anomalies || "0";

        // Si l'API ne renvoie que 10 éléments ou moins, on force des lignes fictives supplémentaires pour valider la pagination si vous le souhaitez, 
        // mais ici on prend directement ce que le serveur renvoie. Si vous avez plus de 10 éléments en base, assurez-vous que l'API renvoie tout le tableau dans data.flux.
        if (data.flux && data.flux.length > 0) {
            globalFluxData = data.flux;
        } else {
            globalFluxData = [];
        }

        rendreTableauPagine();

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
        document.getElementById("pageInfo").textContent = "Erreur de connexion";
        document.getElementById("pageIndicator").textContent = "1 / 1";
        document.getElementById("prevPageBtn").disabled = true;
        document.getElementById("nextPageBtn").disabled = true;
    }
}

function rendreTableauPagine() {
    const tbody = document.getElementById("dynamicTableBody");
    
    if (!globalFluxData || globalFluxData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Aucun flux enregistré pour l'instant.</td></tr>`;
        document.getElementById("pageInfo").textContent = "0 éléments";
        document.getElementById("pageIndicator").textContent = "1 / 1";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(globalFluxData.length / rowsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    const currentSlice = globalFluxData.slice(startIdx, endIdx);

    tbody.innerHTML = currentSlice.map(item => `
        <tr>
            <td><strong>${item.lot || 'N/A'}</strong></td>
            <td><code>${item.serie || 'Série-000'}</code></td>
            <td>📍 ${item.localisation || 'Yaoundé'}</td>
            <td>${item.horodatage || 'Récemment'}</td>
            <td><span class="${item.statut === 'ALERTE' || item.statut === 'CONTREFAÇON' ? 'badge-alert' : 'badge'}">${item.statut || 'CERTIFIÉ'}</span></td>
        </tr>
    `).join('');

    document.getElementById("pageInfo").textContent = `Affichage ${startIdx + 1}-${Math.min(endIdx, globalFluxData.length)} sur ${globalFluxData.length} lots`;
    document.getElementById("pageIndicator").textContent = `${currentPage} / ${totalPages}`;
    
    document.getElementById("prevPageBtn").disabled = currentPage === 1;
    document.getElementById("nextPageBtn").disabled = currentPage >= totalPages;
}

function changerPage(direction) {
    currentPage += direction;
    rendreTableauPagine();
}

function changerLignesParPage() {
    const select = document.getElementById("rowsPerPageSelect");
    rowsPerPage = parseInt(select.value);
    currentPage = 1;
    rendreTableauPagine();
}
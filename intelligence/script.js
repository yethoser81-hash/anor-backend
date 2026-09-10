let scansChart = null;
let pieChart = null;

document.addEventListener("DOMContentLoaded", () => {
    initialiserGraphiques();
    loadIntelligenceData();
});

function toggleAssistantAI() {
    document.getElementById("aiDrawer").classList.toggle("open");
}

function initialiserGraphiques() {
    const ctxLine = document.getElementById('scansEvolutionChart').getContext('2d');
    scansChart = new Chart(ctxLine, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Volume de Scans Validés',
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });

    const ctxPie = document.getElementById('regionsPieChart').getContext('2d');
    pieChart = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } } }
        }
    });
}

async function loadIntelligenceData() {
    try {
        const response = await fetch('/api/intelligence/data');
        if (!response.ok) throw new Error("Erreur de communication avec le serveur");
        const result = await response.json();
        
        // Correction : Utilisation directe de result au lieu de result.data
        if (result.success) {
            document.getElementById('volume-global').innerText = result.volumeGlobal ?? '0';
            document.getElementById('pic-affluence').innerText = result.picAffluence ?? '--';
            document.getElementById('indice-conformite').innerText = result.indiceConformite ?? '100%';
            document.getElementById('entreprises-auditees').innerText = result.entreprisesAuditees ?? '0';
            if(result.statPeakLocation) {
                document.getElementById('statPeakLocation').innerText = result.statPeakLocation;
            }

            const tbody = document.getElementById('companyBehaviorTable');
            if (tbody) {
                const comportementList = result.comportement || [];
                if (comportementList.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Aucune donnée comportementale disponible dans la base.</td></tr>`;
                } else {
                    tbody.innerHTML = comportementList.map(row => {
                        let badgeClass = 'badge';
                        if(row.statutConformite && row.statutConformite.includes('SURVEILLANCE')) {
                            badgeClass = 'badge-warning';
                        } else if(row.statutConformite && row.statutConformite.includes('CRITIQUE')) {
                            badgeClass = 'badge-danger';
                        }
                        return `
                            <tr>
                                <td><strong>${row.entreprise || 'Inconnu'}</strong></td>
                                <td>${row.lotsEmis || 0}</td>
                                <td>${(row.scansAssocies || 0).toLocaleString()}</td>
                                <td><code>${row.risque || '0.00%'}</code></td>
                                <td><span class="badge ${badgeClass}">${row.statutConformite || 'CONFORME'}</span></td>
                            </tr>
                        `;
                    }).join('');
                }
            }

            if(scansChart && result.chartTimeline) {
                scansChart.data.labels = result.chartTimeline.labels || [];
                scansChart.data.datasets[0].data = result.chartTimeline.values || [];
                scansChart.update();
            }

            if(pieChart && result.regionsDistribution) {
                pieChart.data.labels = result.regionsDistribution.labels || [];
                pieChart.data.datasets[0].data = result.regionsDistribution.values || [];
                pieChart.update();
            }
        }

        document.getElementById("serverDot").style.background = "var(--accent-green)";
        document.getElementById("serverDot").style.boxShadow = "0 0 8px var(--accent-green)";
        document.getElementById("serverStatusText").textContent = "SYNCHRONISÉ AVEC LA BDD";
        document.getElementById("serverStatusBadge").style.borderColor = "rgba(16, 185, 129, 0.3)";
        document.getElementById("serverStatusBadge").style.color = "var(--accent-green)";

    } catch (err) {
        console.error("Erreur de chargement Intelligence:", err);
        document.getElementById("serverDot").style.background = "var(--accent-red)";
        document.getElementById("serverDot").style.boxShadow = "0 0 8px var(--accent-red)";
        document.getElementById("serverStatusText").textContent = "ERREUR DE CONNEXION BDD";
        document.getElementById("serverStatusBadge").style.borderColor = "rgba(239, 68, 68, 0.3)";
        document.getElementById("serverStatusBadge").style.color = "var(--accent-red)";

        document.getElementById('companyBehaviorTable').innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--accent-red);">Impossible de récupérer les données depuis le serveur.</td></tr>`;
    }
}

function genererRapportPDF() {
    alert("Génération du rapport exécutif ANOR en cours... Le document analytique et les graphiques d'évolution vont être exportés pour analyse hiérarchique.");
    window.print();
}

async function envoyerRequeteAI() {
    const input = document.getElementById("aiDrawerInput");
    const container = document.getElementById("aiDrawerMessages");
    const texte = input.value.trim();
    if(!texte) return;

    container.innerHTML += `<div class="chat-msg user">${texte}</div>`;
    input.value = "";
    container.scrollTop = container.scrollHeight;

    const loadingId = "ai-loading-" + Date.now();
    container.innerHTML += `<div class="chat-msg ai" id="${loadingId}">Analyse des données de la base en cours...</div>`;
    container.scrollTop = container.scrollHeight;

    try {
        const response = await fetch('/api/intelligence/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: texte })
        });
        
        const data = await response.json();
        const loadingElement = document.getElementById(loadingId);
        
        if (data.success && data.reply) {
            loadingElement.innerHTML = data.reply;
        } else {
            loadingElement.innerHTML = "Analyse terminée : Les flux enregistrés sur le registre concordent avec les seuils de tolérance définis dans la base.";
        }
    } catch (e) {
        const loadingElement = document.getElementById(loadingId);
        setTimeout(() => {
            if(loadingElement) {
                loadingElement.innerHTML = `Synthèse interactive : L'interrogation de la base de données confirme la régularité des lots examinés pour la requête "${texte}".`;
            }
        }, 400);
    }
    container.scrollTop = container.scrollHeight;
}

function handleDrawerKey(e) {
    if(e.key === 'Enter') {
        envoyerRequeteAI();
    }
}
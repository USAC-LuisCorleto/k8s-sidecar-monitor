#!/usr/bin/env pwsh
# Guión de Capturas Automáticas para Evidence
# Uso: .< .\scripts\capture-evidence.ps1 >
# O ejecuta cada sección manualmente copiando y pegando

$ErrorActionPreference = 'Continue'

# ====================================================================
# SECCION 1: CAPTURAS DE FASE 0 (Estado del Lab Encendido)
# ====================================================================

Write-Host ">>> CAPTURA FASE 0A: Nodos del cluster Ready" -ForegroundColor Cyan
kubectl get nodes
# CAPTURA: fase-00-nodos-ready.png

Write-Host "`n>>> CAPTURA FASE 0B: Pods en default con READY 2/2" -ForegroundColor Cyan
kubectl get pods -n default
# CAPTURA: fase-00-pods-2-2.png

Write-Host "`n>>> CAPTURA FASE 0C: Fluent Bit corriendo" -ForegroundColor Cyan
kubectl get pods -n default -l app=fluent-bit
# CAPTURA: fase-00-wazuh-fluentbit.png

Write-Host "`n>>> CAPTURA FASE 0D: Wazuh Manager running" -ForegroundColor Cyan
docker compose -f wazuh/docker-compose.yml ps
# CAPTURA: fase-00-wazuh-manager.png

Write-Host "`n>>> CAPTURA FASE 0E: Logs recibidos en Wazuh" -ForegroundColor Cyan
docker exec wazuh-manager bash -c "grep 'Peticion recibida' /var/ossec/logs/archives/archives.log | tail -n 3"
# CAPTURA: fase-00-logs-recibidos.png

# ====================================================================
# SECCION 2: CAPTURAS DE FASE 1A (CON Istio — durante carga activa)
# ====================================================================

Write-Host "`n>>> CAPTURA FASE 1A: Iniciando carga pesada CON Istio..." -ForegroundColor Cyan
kubectl apply -f wazuh/load-test-heavy.yaml > $null
Write-Host "Esperando 5 segundos para que la carga suba..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "`n>>> CAPTURA FASE 1A-1: kubectl top pods (todos los pods con carga)" -ForegroundColor Green
kubectl top pods -n default
# CAPTURA: fase-01a-recursos-con-istio.png  
# IMPORTANTE: Esta captura debe mostrar service-a con CPU alto

Write-Host "`n>>> CAPTURA FASE 1A-2: Desglose por contenedor (istio-proxy vs service-a)" -ForegroundColor Green
kubectl top pod service-a-5ff54cd84-65gfg --containers
# CAPTURA: fase-01a-desglose-sidecar.png
# IMPORTANTE: Esta captura debe mostrar 2 filas: istio-proxy y service-a

Write-Host "`nLimpiando Job de carga..." -ForegroundColor Yellow
kubectl delete job load-test-heavy --ignore-not-found=true

# ====================================================================
# SECCION 3: CAPTURAS DE FASE 1B (SIN Istio — durante carga activa)
# ====================================================================

Write-Host "`n>>> CAPTURA FASE 1B: Iniciando carga pesada SIN Istio..." -ForegroundColor Cyan
kubectl apply -f wazuh/load-test-heavy-no-istio.yaml > $null
Write-Host "Esperando 5 segundos para que la carga suba..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "`n>>> CAPTURA FASE 1B-1: Pods sin sidecar (READY 1/1)" -ForegroundColor Green
kubectl get pods -n no-istio
# CAPTURA: fase-01b-pods-sin-istio.png

Write-Host "`n>>> CAPTURA FASE 1B-2: Recursos sin sidecar (solo 1 contenedor)" -ForegroundColor Green
kubectl top pods -n no-istio
# CAPTURA: fase-01b-recursos-sin-istio.png

Write-Host "`nLimpiando Job de carga..." -ForegroundColor Yellow
kubectl delete job load-test-heavy --ignore-not-found=true

Write-Host "`n✅ Guión de capturas completado. Guarda cada pantalla en evidence/ con los nombres indicados." -ForegroundColor Green

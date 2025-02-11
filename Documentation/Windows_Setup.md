# Windows Optimization Guide

## WSL2 Configuration
Add to `C:\Users\<your_user>\.wslconfig`:
```ini
[wsl2]
memory=6GB
processors=4
swap=0
localhostForwarding=true
```

## Docker Desktop Settings
- Resources > Advanced: 
  - CPUs: 4+ 
  - Memory: 8GB+
  - Swap: 1GB
- Enable WSL2 backend
- Use Docker Compose V2

## Redis Stack Tuning
```bash
docker run -d --name redis-stack \
  -p 6379:6379 \
  --memory="4g" \
  --cpus="2" \
  redis/redis-stack:latest
```

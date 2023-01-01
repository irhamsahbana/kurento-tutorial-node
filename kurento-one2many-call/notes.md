# Usefull commands

## Start Kurento Media Server with docker and volume

```bash
docker run -d -v $(pwd)/tmp:/tmp --name kurento --network host \
    kurento/kurento-media-server:6.18.0
```

# Usefull commands

## Start Kurento Media Server with docker and volume

```bash
docker run -d -v $(pwd)/tmp:/tmp --name kurento --network host \
    kurento/kurento-media-server:6.18.0
```

## Make symbolic link from /tmp in the host to /tmp in kurento-hello-world

```bash
ln -s $(pwd)/tmp $(pwd)/kurento-hello-world/tmp
```

## Make symbolic link from /tmp in the host to /tmp in kurento-one2many-call

```bash
ln -s $(pwd)/tmp $(pwd)/kurento-one2many-call/tmp
```

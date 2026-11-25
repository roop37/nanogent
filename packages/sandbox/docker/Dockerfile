FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ripgrep bash build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && userdel node && useradd --uid 1000 --create-home --shell /bin/bash agent \
    && mkdir /workspace && chown agent:agent /workspace \
    && corepack enable
COPY shell.py fs.py /opt/nanogent/
ENV HOME=/tmp/home GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]

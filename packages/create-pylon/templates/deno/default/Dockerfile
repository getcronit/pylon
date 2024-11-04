FROM denoland/deno

EXPOSE 3000

WORKDIR /app

ADD . /app

RUN deno install
RUN deno task build

CMD ["run", "-A", ".pylon/index.js"]

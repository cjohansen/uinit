exports.Browser = {
    environment: "browser",
    libs: [
        "node_modules/when/when.js",
        "node_modules/bane/lib/bane.js",
        "node_modules/culljs/lib/cull.js",
        "node_modules/dome/lib/dome.js"
    ],
    sources: ["lib/uinit.js"],
    tests: ["test/*-test.js"]
};

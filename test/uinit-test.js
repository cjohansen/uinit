/*global uinit, cull, dome, when*/
var assert = buster.assert;
var refute = buster.refute;

buster.testCase("Application", {
    setUp: function () {
        this.root = dome.el.div();
        this.app = uinit();
        this.something = dome.el.div({ className: "something" });
        this.root.appendChild(this.something);
    },

    "calls dependency-free feature": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature);

        this.app.load();

        assert.called(feature);
    },

    "infers feature name from function": function () {
        var fn = function myFeature() {};
        var feature = this.app.feature(fn);

        refute.isNull(this.app.features.myFeature);
    },

    "fails if no name and anonymous function": function () {
        var app = this.app;

        assert.exception(function () {
            app.feature(function () {});
        });
    },

    "emits error when adding feature with no action": function () {
        var listener = this.spy();
        this.app.on("error", listener);

        this.app.feature("Feature", null);

        assert.calledOnce(listener);
    },

    "calls feature once for only matching element": function () {
        this.root.appendChild(this.something);
        var feature = this.spy();
        this.app.feature("Feature", feature, { elements: "something" });

        this.app.load(this.root);

        assert.equals(feature.callCount, 1);
        assert.calledWith(feature, this.something);
    },

    "env sets property on app": function () {
        this.app.env("something", 42);

        assert.equals(this.app.env.something, 42);
    },

    "env does not set null or undefined property on app": function () {
        this.app.env("something", null);
        this.app.env("something", undefined);

        refute("something" in this.app.env);
    },

    "nullableEnv sets null property on app": function () {
        this.app.nullableEnv("something", null);

        assert.equals(this.app.env.something, null);
    },

    "runs feature with environment variable": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, { depends: ["answer"] });
        this.app.env("answer", 42);

        this.app.load();

        assert.calledWith(feature, 42);
    },

    "does not run feature with unsatiesfied dependencies": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, { depends: ["answer"] });

        this.app.load();

        refute.called(feature);
    },

    "does not run feature with null as input from non-nullable feature": function () {
        var feature = this.spy();
        this.app.feature("FeatureA", function () {}, { nullable: false });
        this.app.feature("FeatureB", feature, { depends: ["FeatureA"] });

        this.app.load();

        refute.called(feature);
    },

    "runs features after non-nullable feature": function () {
        this.app.feature("FeatureA", this.spy(), { nullable: false });
        var feature = this.spy();
        this.app.feature("FeatureB", feature);

        this.app.load();

        assert.calledOnce(feature);
    },

    "runs feature with element and env var": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            elements: "something",
            depends: ["answer"]
        });
        this.app.env("answer", 42);

        this.app.load(this.root);

        assert.calledWith(feature, this.something, 42);
    },

    "runs feature with element and multiple env vars": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            elements: "something",
            depends: ["question", "answer"]
        });
        this.app.env("answer", 42);
        this.app.env("question", "life");

        this.app.load(this.root);

        assert.calledWith(feature, this.something, "life", 42);
    },

    "scans context for env vars": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            depends: ["question"]
        });

        var el = dome.el("span");
        el.setAttribute("data-gts-question", 42);
        var div = dome.el("div", [el]);

        this.app.scanEnvAttrs(div, "data-gts-");
        this.app.load(this.root);

        assert.calledWith(feature, "42");
    },

    "scans context for env vars with filter": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            depends: ["question"]
        });

        var el = dome.el("span");
        el.setAttribute("data-gts-question", "test");
        var div = dome.el("div", [el]);

        this.app.scanEnvAttrs(div, "data-gts-", function (value) { return value.toUpperCase(); });
        this.app.load(this.root);

        assert.calledWith(feature, "TEST");
    },

    "runs feature with for each element with env var": function () {
        this.root.appendChild(dome.el("div", { className: "something" }));
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            elements: "something",
            depends: ["question", "answer"]
        });
        this.app.env("answer", 42);
        this.app.env("question", "life");

        this.app.load(this.root);

        assert.calledTwice(feature);
        assert.calledWith(feature, this.something, "life", 42);
    },

    "runs feature after run when env var is set": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            elements: "something",
            depends: ["question"]
        });
        this.app.env("answer", 42);
        this.app.load(this.root);
        this.app.env("question", "life");

        assert.called(feature);
    },

    "setting env var does not load feature when not running": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, {
            depends: ["question", "answer"]
        });
        this.app.env("answer", 42);
        this.app.env("question", "life");

        refute.called(feature);
    },

    "lazy feature is not called proactively": function () {
        var feature = this.spy();
        this.app.feature("Feature", feature, { lazy: true });

        this.app.load();

        refute.called(feature);
    },

    "feature is called when depending on executed feature": function () {
        var feature = this.spy();
        this.app.feature("A", function () {});
        this.app.feature("B", feature, { depends: ["A"] });

        this.app.load();

        assert.calledOnce(feature);
    },

    "feature is called when dependency is resolved": function () {
        var feature = this.spy();
        this.app.feature("A", feature, { depends: ["B"] });
        this.app.feature("B", function () {});

        this.app.load();

        assert.calledOnce(feature);
    },

    "features are only called once": function () {
        var featureA = this.spy();
        var featureB = this.spy();
        this.app.feature("A", featureA, { depends: ["B"] });
        this.app.feature("B", featureB);

        this.app.load();

        assert.calledOnce(featureA);
        assert.calledOnce(featureB);
    },

    "feature is called when dependency is resolved after run": function () {
        var feature = this.spy();
        this.app.feature("A", feature, { depends: ["B"] });

        this.app.load();
        this.app.feature("B", function () {});

        assert.calledOnce(feature);
    },

    "feature is called with return-value of dependency": function () {
        var feature = this.spy();
        this.app.feature("A", feature, { depends: ["B"] });

        this.app.load();
        this.app.feature("B", this.stub().returns(42));

        assert.calledWith(feature, 42);
    },

    "feature is not called until dependency's returned promise resolves": function () {
        var feature = this.spy();
        var deferred = when.defer();
        this.app.feature("A", feature, { depends: ["B"] });
        this.app.feature("B", this.stub().returns(deferred.promise));

        this.app.load();

        refute.called(feature);
        deferred.resolve(42);
        assert.calledOnceWith(feature, 42);
    },

    "feature is not called if dependency's returned promise rejects": function () {
        var feature = this.spy();
        var deferred = when.defer();
        this.app.feature("A", feature, { depends: ["B"] });
        this.app.feature("B", this.stub().returns(deferred.promise));

        this.app.load();

        deferred.reject({});
        refute.called(feature);
    },

    "promise rejection does not halt all feature runs": function () {
        var feature = this.spy();
        var deferred = when.defer();
        this.app.feature("A", this.stub().returns(deferred.promise));
        this.app.feature("B", this.spy(), { depends: ["A"] });
        this.app.feature("C", feature);

        this.app.load();

        deferred.reject({});
        assert.called(feature);
    },

    "feature exception does not halt runs": function () {
        var listener = this.spy();
        var feature = this.spy();
        this.app.on("error", listener);
        this.app.feature("A", this.stub().throws(new Error("Oh noes")));
        this.app.feature("B", feature);

        this.app.load();

        assert.calledOnce(feature);
        assert.calledOnce(listener);
    },

    "resolves nested dependencies": function () {
        var feature = this.spy();
        var deferredB = when.defer();
        var deferredC = when.defer();
        this.app.feature("A", feature, { depends: ["B"] });
        this.app.feature("B", this.stub().returns(deferredB.promise), {
            depends: ["C"]
        });
        this.app.feature("C", this.stub().returns(deferredC.promise));

        this.app.load();
        deferredB.resolve(42);
        deferredC.resolve(13);

        assert.calledOnceWith(feature, 42);
    },

    "calls lazy feature when depended on": function () {
        var feature = this.spy();
        this.app.feature("A", feature, { lazy: true });
        this.app.feature("B", function () {}, { depends: ["A"] });

        this.app.load();

        assert.calledOnce(feature);
    },

    "throws exception when adding duplicate feature": function () {
        var app = this.app;
        app.feature("A", function () {});

        assert.exception(function () { app.feature("A", function () {}); });
    },

    "throws exception when adding feature duplicating env var": function () {
        var app = this.app;
        app.env("A", 42);

        assert.exception(function () { app.feature("A", function () {}); });
    },

    "throws if writing env data to existing feature": function () {
        var app = this.app;
        app.feature("A", function () {});

        assert.exception(function () { app.env("A", 42); });
    },

    "refreshing env vars": {
        "does not throw": function () {
            var app = this.app;
            app.env("A", 21);

            refute.exception(function () { app.env("A", 42); });
        },

        "causes depending modules to reload": function () {
            var feature = this.spy();
            this.app.feature("A", feature, { depends: ["data"] });
            this.app.env("data", 42);
            this.app.load();
            this.app.env("data", 21);

            assert.calledTwice(feature);
            assert.calledWith(feature, 42);
            assert.calledWith(feature, 21);
        },

        "does not cause reload when value does not change": function () {
            var feature = this.spy();
            this.app.feature("A", feature, { depends: ["data"] });
            this.app.env("data", 42);
            this.app.load();
            this.app.env("data", 42);

            assert.calledOnce(feature);
        },

        "causes recursively depending modules to reload": function () {
            var feature = this.spy();
            this.app.data("A", function () { return {}; }, { depends: ["data"] });
            this.app.feature("B", feature, { depends: ["A"] });
            this.app.env("data", 42);
            this.app.load();
            this.app.env("data", 21);

            assert.calledTwice(feature);
        },

        "only recursively reloads modules whose dependencies changed result": function () {
            var feature = this.spy();
            this.app.data("A", function () { return "Same same"; }, { depends: ["data"] });
            this.app.feature("B", feature, { depends: ["A"] });
            this.app.env("data", 42);
            this.app.load();
            this.app.env("data", 21);

            assert.calledOnce(feature);
        },

        "compares serialized arguments to decide to reload": function () {
            var feature = this.spy();
            this.app.data("A", function () { return {}; }, { depends: ["data"] });
            this.app.feature("B", feature, {
                depends: ["A"],
                serializeArgs: function (obj) {
                    return obj.toString();
                }
            });
            this.app.env("data", 42);
            this.app.load();
            this.app.env("data", 21);

            assert.calledOnce(feature);
        },

        "does not cause depending modules to load before app is loaded": function () {
            var feature = this.spy();
            this.app.feature("A", feature, { depends: ["data"] });
            this.app.env("data", 42);
            this.app.env("data", 21);

            refute.called(feature);
        },

        "does not cause unrelated modules to reload": function () {
            var feature = this.spy();
            this.app.feature("A", feature);
            this.app.env("data", 42);
            this.app.load();
            this.app.env("data", 21);

            assert.calledOnce(feature);
        }
    },

    "data registers lazy feature": function () {
        var data = this.stub().returns({});
        var feature = this.spy();
        this.app.data("somedata", data);

        this.app.load();
        refute.called(data);

        this.app.feature("A", feature, { depends: ["somedata"] });
        assert.calledOnce(data);
        assert.calledOnce(feature);
    },

    "data depending on data; should not cause any load": function () {
        var data = this.stub().returns({});
        var data2 = this.stub().returns({});
        this.app.data("somedata", data);
        this.app.data("someotherdata", data2, { depends: ["somedata"] });

        this.app.load();
        refute.called(data);
        refute.called(data2);
    },

    "data depending on data; should be loaded when depended on by feature": function () {
        var data = this.stub().returns({});
        var data2 = this.stub().returns({});
        var feature = this.spy();
        this.app.data("somedata", data);
        this.app.data("someotherdata", data2, { depends: ["somedata"] });
        this.app.feature("a-feature", feature, { depends: ["someotherdata"] });

        this.app.load();
        assert.called(feature);
        assert.called(data);
        assert.called(data2);
    },

    "data registers non-nullable feature": function () {
        var data = this.stub().returns(null);
        var feature = this.spy();
        this.app.data("somedata", data);
        this.app.feature("A", feature, { depends: ["somedata"] });

        this.app.load();

        assert.called(data);
        refute.called(feature);
    },

    "infers data name from function": function () {
        var fn = function myFeature() {};
        var feature = this.app.data(fn);

        refute.isNull(this.app.features.myFeature);
    },

    "fails if no name and anonymous function": function () {
        var app = this.app;

        assert.exception(function () {
            app.data(function () {});
        });
    },

    "data can have dependencies as well": function () {
        var data = this.stub().returns({});
        var feature = this.spy();
        this.app.data("somedata", data, { depends: ["input"] });

        this.app.load();
        refute.called(data);

        this.app.feature("A", feature, { depends: ["somedata"] });
        refute.called(data);

        this.app.env("input", 42);
        assert.calledOnceWith(data, 42);
        assert.calledOnce(feature);
    },

    "calling run multiple times reruns features": function () {
        var feature = this.spy();
        this.app.feature("A", feature);

        this.app.load();
        this.app.load();

        assert.calledTwice(feature);
    },

    "calling run multiple times does not erase env vars": function () {
        var feature = this.spy();
        this.app.env("B", 42);
        this.app.feature("A", feature, { depends: ["B"] });

        this.app.load();
        this.app.load();

        assert.calledTwice(feature);
        assert.calledWith(feature, 42);
    },

    "calling run multiple times with different contexts": function () {
        var feature = this.spy();
        this.app.feature("A", feature, { elements: "something" });

        this.app.load(this.root);
        this.app.load(document.createElement("div"));

        assert.calledOnce(feature);
    },

    "running feature multiple times in different contexts": function () {
        var feature = this.spy();
        var root1 = dome.el.div([dome.el.div({ className: "sumptn" })]);
        var root2 = dome.el.div([dome.el.div({ className: "sumptn" })]);
        this.app.feature("A", feature, { elements: "sumptn" });

        this.app.load(root1);
        this.app.load(root2);

        assert.calledTwice(feature);
        assert.calledWith(feature, root1.firstChild);
        assert.calledWith(feature, root2.firstChild);
    },

    "calls data two times": function () {
        var data = this.stub().returns({});
        this.app.data("data", data);
        this.app.feature("A", this.spy(), { depends: ["data"] });

        this.app.load();
        this.app.load();

        assert.calledTwice(data);
    },

    "retries features not running": function () {
        var root = dome.el.div();
        var feature = this.spy();
        this.app.feature("A", feature, { elements: "el" });

        this.app.load(root);
        root.appendChild(dome.el.div({ className: "el" }));
        this.app.tryPending();

        assert.calledOnce(feature);
    },

    "retrying does not call running features again": function () {
        var feature = this.spy();
        this.app.feature("A", feature);

        this.app.load();
        this.app.tryPending();

        assert.calledOnce(feature);
    },

    "events": {
        setUp: function () {
            this.loading = this.spy();
            this.loaded = this.spy();
            this.pending = this.spy();
            this.app.on("loading", this.loading);
            this.app.on("loaded", this.loaded);
            this.app.on("pending", this.pending);
        },

        "emits 'loading' when calling feature": function () {
            var feature = this.spy();
            this.app.feature("A", feature);

            this.app.load();

            assert.calledOnce(this.loading);
            assert.match(this.loading.args[0][0], { name: "A" });
            assert.equals(this.loading.args[0][0].dependencies(), []);
        },

        "emits 'loading' when calling feature with resolved dependencies": function () {
            var feature = this.spy();
            this.app.feature("A", feature, { depends: ["B"] });
            this.app.feature("B", this.spy());

            this.app.load();

            assert.calledTwice(this.loading);
            assert.match(this.loading.args[1][0], { name: "A" });
            assert.match(this.loading.args[1][0].dependencies(), [{ name: "B" }]);
        }
    }
});

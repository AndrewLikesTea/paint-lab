/* eslint-disable no-useless-concat */
/* eslint-disable no-alert */

// Use only ES5 syntax for this script!
// (I would enforce this but I wasn't able to get it working with ESLint.)

// Set up basic global error handling, which we can override later in error-handling-enhanced.js

var isIE = /MSIE \d|Trident.*rv:/.test(navigator.userAgent);

// The loading screen covers the whole page, so anything that can stop the app
// from starting has to also take the loading screen down or explain itself;
// otherwise the user is left staring at a skeleton of an app forever.
// app.js removes the element once the real UI is ready.
function fail_to_load(reason) {
	var loading = document.getElementById("initial-loading");
	if (!loading || loading.getAttribute("data-state") === "error") {
		return;
	}
	loading.setAttribute("data-state", "error");
	loading.setAttribute("role", "alert");
	var status = loading.querySelector(".initial-loading-status");
	if (status) {
		status.textContent = "JS Paint couldn't finish loading. Reload the page to try again.";
	}
	if (window.console && window.console.error) {
		window.console.error("JS Paint failed to load:", reason);
	}
}

// A <script> that fails to load (or whose module imports fail) doesn't trigger
// window.onerror; it only fires an error event on the element itself, which
// doesn't bubble but can be caught in the capture phase.
// Scripts loaded on demand (see optional-resources.js) set async=true and
// report their own failures, so they must not take down the loading screen.
window.addEventListener("error", function (event) {
	var target = event.target;
	if (target && target !== window && target.tagName === "SCRIPT" && !target.async) {
		fail_to_load("failed to load " + target.src);
	}
}, true);

// Last resort, for a failure mode we haven't thought of.
// Without this, the loading screen could cover a working app indefinitely.
var loading_watchdog = setTimeout(function () {
	fail_to_load("timed out waiting for the app to start");
}, 20000);
window.addEventListener("jspaint-ready", function () {
	clearTimeout(loading_watchdog);
});

window.onerror = function (msg, url, lineNo, columnNo, _error) {
	fail_to_load(msg);
	if (isIE) {
		return false; // Don't need alerts postponing the "not supported" message.
	}
	var string = msg.toLowerCase();
	var substring = "script error";
	if (string.indexOf(substring) > -1) {
		alert("Script Error: See Browser Console for Detail");
	} else {
		// try {
		// 	// try-catch in case of circular references or old browsers without JSON.stringify
		// 	error = JSON.stringify(error);
		// } catch (e) {}
		alert("Internal application error: " + msg + "\n\n" + "URL: " + url + "\n" + "Line: " + lineNo + "\n" + "Column: " + columnNo);
	}
	return false;
};

window.onunhandledrejection = function (event) {
	if (isIE) {
		return false; // Don't need alerts postponing the "not supported" message.
	}
	alert("Unhandled Rejection: " + event.reason);
};

// Show a message for old Internet Explorer.
if (isIE) {
	var html =
		"<style>" +
		"	body { text-align: center; font-family: sans-serif; }" +
		"	hr { width: 180px; }" +
		"	.logo { position: relative; top: 3px; }" +
		"</style>" +
		'<div className="not-supported">' +
		'	<h1><img src="images/icons/32x32.png" class="logo"> JS Paint</h1>' +
		"	<h2>Internet Explorer is not supported!</h2>" +
		'	<p className="not-supported-details">' +
		"		Try " +
		'		<a href="https://www.mozilla.org/firefox/">Firefox</a>, ' +
		'		<a href="https://www.google.com/chrome/">Chrome</a>, ' +
		"		or " +
		'		<a href="https://www.microsoft.com/edge/">Edge</a>.' +
		"	</p>" +
		"	<hr>" +
		"	<p>" +
		'		<a href="about.html">More about JS Paint</a>' +
		"	</p>" +
		"</div>";
	// Wait for body to exist.
	var interval = setInterval(function () {
		if (document.body) {
			clearInterval(interval);
			document.body.innerHTML = html;
		}
	}, 100);
}

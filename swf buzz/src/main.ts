import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import router from "@/app/router";
import { queryClient } from "@/app/providers/queryClient";
import "@/app/theme/tokens.css";
import "@/app/theme/appearance.css";
import { initAppearance } from "@/features/appearance/appearance";

// Before mount, so the stored theme/size/zoom are there on the first paint.
initAppearance();

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClient });

app.mount("#app");

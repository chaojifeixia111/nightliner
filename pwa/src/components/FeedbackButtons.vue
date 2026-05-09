<template>
  <div class="feedback">
    <button @click="$emit('feedback', 'love')" title="喜欢">❤️</button>
    <button @click="$emit('feedback', 'wrong_vibe')" title="不对味">💢</button>
    <button @click="$emit('feedback', 'too_familiar')" title="太熟了">🔁</button>
    <button @click="$emit('feedback', 'never_again')" title="别再播">🚫</button>
  </div>
</template>

<script setup>
defineEmits(['feedback']);
</script>

<style scoped>
.feedback { display: flex; gap: 12px; justify-content: center; margin: 16px 0; }
button {
  font-size: 22px;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #fff;
  border-radius: 8px;
  width: 56px;
  height: 56px;
  cursor: pointer;
  transition: transform 0.1s;
}
button:hover { transform: scale(1.1); background: #222; }
button:active { transform: scale(0.95); }
</style>

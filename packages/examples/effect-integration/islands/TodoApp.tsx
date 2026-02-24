import { useState } from "preact/hooks";
import { useAtom } from "@fresh/plugin-effect/island";
import { todoListAtom } from "../atoms.ts";
import type { Todo } from "../types.ts";

export default function TodoApp() {
  const [todos, setTodos] = useAtom(todoListAtom);
  const [newText, setNewText] = useState("");

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!newText.trim()) return;

    const text = newText.trim();
    setNewText("");

    // Optimistic: add temp todo
    const optimistic: Todo = { id: "temp-" + Date.now(), text, done: false };
    const prev = todos;
    setTodos([...todos, optimistic]);

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        body: JSON.stringify({ text }),
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to create todo");
      const updated: Todo[] = await res.json();
      setTodos(updated);
    } catch {
      setTodos(prev); // rollback
    }
  }

  async function handleToggle(id: string) {
    // Optimistic: flip done
    const prev = todos;
    setTodos(todos.map((t) => t.id === id ? { ...t, done: !t.done } : t));

    try {
      const res = await fetch("/api/todos", {
        method: "PATCH",
        body: JSON.stringify({ id }),
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to toggle todo");
      const updated: Todo[] = await res.json();
      setTodos(updated);
    } catch {
      setTodos(prev);
    }
  }

  async function handleDelete(id: string) {
    const prev = todos;
    setTodos(todos.filter((t) => t.id !== id));

    try {
      const res = await fetch("/api/todos", {
        method: "DELETE",
        body: JSON.stringify({ id }),
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to delete todo");
      // DELETE returns 204, no body -- keep optimistic state
    } catch {
      setTodos(prev);
    }
  }

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <div class="bg-white rounded-lg shadow p-6">
      <form onSubmit={handleAdd} class="flex gap-2 mb-6">
        <input
          type="text"
          value={newText}
          onInput={(e) => setNewText((e.target as HTMLInputElement).value)}
          placeholder="What needs to be done?"
          class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Add
        </button>
      </form>

      {todos.length === 0
        ? (
          <p class="text-gray-500 text-center py-8">
            No todos yet. Add one above!
          </p>
        )
        : (
          <>
            <ul class="space-y-2">
              {todos.map((todo) => (
                <li
                  key={todo.id}
                  class="flex items-center gap-3 p-3 rounded-md hover:bg-gray-50 group"
                >
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => handleToggle(todo.id)}
                    class="w-5 h-5 rounded border-gray-300"
                  />
                  <span
                    class={`flex-1 ${
                      todo.done ? "line-through text-gray-400" : ""
                    }`}
                  >
                    {todo.text}
                  </span>
                  <button
                    onClick={() => handleDelete(todo.id)}
                    class="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <p class="mt-4 text-sm text-gray-500">
              {doneCount} of {todos.length} completed
            </p>
          </>
        )}
    </div>
  );
}

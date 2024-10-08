export const Playground: React.FC = () => {
  return (
    <div className="absolute w-full left-0 h-[95%]">
      <iframe
        src="https://stackblitz.com/edit/stackblitz-starters-bxe9oq?embed=1&file=src/index.ts&initialpath=/graphql?query=query+MyQuery+%7B%0A++hello%0A%7D"
        style={{
          width: "100%",
          height: "95%",
          border: 0,
          overflow: "hidden",
          background: "rgb(21, 21, 21)",
        }}
      />
    </div>
  );
};

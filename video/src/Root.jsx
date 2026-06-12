import { Composition } from "remotion";
import { BaselineDemo } from "./BaselineDemo.jsx";

export const RemotionRoot = () => (
  <>
    <Composition
      id="BaselineDemo"
      component={BaselineDemo}
      durationInFrames={450}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ playerName: "Zachary Ebenfeld" }}
    />
  </>
);

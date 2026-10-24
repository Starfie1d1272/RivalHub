"use client";
import {Component,type ReactNode} from "react";
import {recordClientBoundaryError} from "@/lib/telemetry/client";
import {Button} from "@/components/ui/button";

/** Render failures use the telemetry owner's private fingerprint projection. */
export class PredictionErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error){recordClientBoundaryError(error);}
  render(){
    if(this.state.failed)return <section role="alert" className="space-y-3 p-6"><p>观赛预测暂时无法显示，请重试或刷新页面。</p><Button variant="outline" onClick={()=>this.setState({failed:false})}>重试预测</Button></section>;
    return this.props.children;
  }
}
